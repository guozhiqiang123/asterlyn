import type { EditorState, Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  ViewPlugin,
  WidgetType,
  gutter,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { GitBlameHunk, GitBlameResult } from "../../models.ts";
import {
  formatGitBlameDate,
  formatGitBlameDateTime,
} from "../../presentation/date-time.ts";

export interface GitBlameSource {
  repositoryRoot: string;
  repositoryId: string;
  path: string;
  commitOid: string | null;
  parent: boolean;
}

export interface GitBlameAvailability {
  source: GitBlameSource | null;
  unavailableReason: string | null;
}

export interface DiffGitBlameSources {
  old: GitBlameAvailability;
  new: GitBlameAvailability;
  unifiedReason: string;
}

export interface ConflictGitBlameSources {
  ours: GitBlameAvailability;
  theirs: GitBlameAvailability;
  unifiedReason: string;
}

export interface GitBlameRuntime {
  load(source: GitBlameSource): Promise<GitBlameResult>;
  openCommit(source: GitBlameSource, hunk: GitBlameHunk): void;
  status(message: string, kind: "information" | "warning"): void;
  error(error: unknown): void;
}

export interface GitBlameCopy {
  gutterActions: string;
  annotateGitBlame: string;
  hideGitBlame: string;
  loadingGitBlame: string;
  gitBlameLocal: string;
  gitBlameRequiresSavedFile: string;
  gitBlameRequiresTrackedFile: string;
  gitBlameRequiresSplit: string;
  gitBlameLoaded(lines: number): string;
  gitBlameLimited(lines: number): string;
  gitBlameHidden: string;
  gitBlameDetails(
    author: string,
    email: string,
    date: string,
    oid: string,
    summary: string,
  ): string;
}

type SourceLineMapper = (documentLine: number) => number | null;
export type OpenEditorContextMenu = (event: MouseEvent, view: EditorView) => void;
export type OpenGitBlameCommit = (hunk: GitBlameHunk) => void;

export type DiffGutterSide = "before" | "after";
type LineNumberFormatter = (lineNumber: number, state: EditorState) => string;

export function lineNumberGutter(
  formatNumber?: (lineNumber: number) => string,
  side: DiffGutterSide = "before",
  openMenu?: OpenEditorContextMenu,
): Extension {
  return diffLineNumberGutter(
    side,
    formatNumber ? (lineNumber) => formatNumber(lineNumber) : undefined,
    openMenu,
  );
}

/** Opens the editor gutter menu from every gutter lane, including empty space. */
export function editorGutterContextMenu(
  openMenu: OpenEditorContextMenu,
): Extension {
  return ViewPlugin.fromClass(class {
    constructor(private readonly view: EditorView) {
      view.dom.addEventListener("contextmenu", this.contextmenu);
    }

    destroy(): void {
      this.view.dom.removeEventListener("contextmenu", this.contextmenu);
    }

    private readonly contextmenu = (event: MouseEvent): void => {
      const gutters = event.target instanceof Element
        ? event.target.closest(".cm-gutters")
        : null;
      if (!gutters || !this.view.dom.contains(gutters)) return;
      requestContextMenu(event, this.view, openMenu);
    };
  });
}

/** A line-number gutter that supports both sides of split Diff layouts. */
export function diffLineNumberGutter(
  side: DiffGutterSide,
  formatNumber: LineNumberFormatter = (lineNumber) => lineNumber.toString(),
  openMenu?: OpenEditorContextMenu,
): Extension {
  return gutter({
    class: `cm-lineNumbers cm-diff-lineNumbers cm-diff-lineNumbers-${side}`,
    side,
    lineMarker: (view, line) => {
      const documentLine = view.state.doc.lineAt(line.from).number;
      return new DiffLineNumberMarker(
        formatNumber(documentLine, view.state),
        documentLine,
      );
    },
    initialSpacer: (view) => new DiffLineNumberMarker(
      formatNumber(maxLineNumber(view.state.doc.lines), view.state),
      null,
    ),
    updateSpacer: (spacer, update) => {
      const number = formatNumber(maxLineNumber(update.state.doc.lines), update.state);
      return spacer instanceof DiffLineNumberMarker && spacer.number === number
        ? spacer
        : new DiffLineNumberMarker(number, null);
    },
    ...(openMenu ? {
      domEventHandlers: {
        contextmenu: (view, _line, event) => {
          requestContextMenu(event as MouseEvent, view, openMenu);
          return true;
        },
      },
    } : {}),
  });
}

/** Shows the restored blame gutter and keeps the compact active-line annotation. */
export function gitBlamePresentation(
  result: GitBlameResult,
  copy: GitBlameCopy,
  openMenu: OpenEditorContextMenu,
  openCommit: OpenGitBlameCommit,
  sourceLine: SourceLineMapper = (line) => line,
): Extension {
  const hunks = [...result.hunks].sort(
    (left, right) => left.finalStartLine - right.finalStartLine,
  );
  return [
    blameGutter(hunks, copy, openMenu, openCommit, sourceLine),
    blameLineEndPresentation(hunks, copy, openCommit, sourceLine),
  ];
}

function blameGutter(
  hunks: readonly GitBlameHunk[],
  copy: GitBlameCopy,
  openMenu: OpenEditorContextMenu,
  openCommit: OpenGitBlameCommit,
  sourceLine: SourceLineMapper,
): Extension {
  return gutter({
    class: "cm-git-blame-gutter",
    lineMarker: (view, line) => {
      const documentLine = view.state.doc.lineAt(line.from).number;
      const mappedLine = sourceLine(documentLine);
      if (mappedLine === null) return null;
      const hunk = blameHunkAt(hunks, mappedLine);
      return hunk ? new GitBlameMarker(hunk, copy, openCommit) : null;
    },
    domEventHandlers: {
      contextmenu: (view, _line, event) => {
        requestContextMenu(event as MouseEvent, view, openMenu);
        return true;
      },
    },
  });
}

function requestContextMenu(
  event: MouseEvent,
  view: EditorView,
  openMenu: OpenEditorContextMenu,
): void {
  event.preventDefault();
  event.stopPropagation();
  openMenu(event, view);
}

function blameHunkAt(hunks: readonly GitBlameHunk[], line: number): GitBlameHunk | null {
  let low = 0;
  let high = hunks.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const hunk = hunks[middle]!;
    if (line < hunk.finalStartLine) high = middle - 1;
    else if (line >= hunk.finalStartLine + hunk.lineCount) low = middle + 1;
    else return hunk;
  }
  return null;
}

class GitBlameMarker extends GutterMarker {
  readonly elementClass: string;

  constructor(
    private readonly hunk: GitBlameHunk,
    private readonly copy: GitBlameCopy,
    private readonly openCommit: OpenGitBlameCommit,
  ) {
    super();
    this.elementClass = hunk.uncommitted
      ? "cm-git-blame-uncommitted cm-git-blame-local"
      : `cm-git-blame-tone-${blameTone(hunk.oid)}`;
  }

  eq(other: GitBlameMarker): boolean {
    return this.hunk === other.hunk && this.copy === other.copy && this.openCommit === other.openCommit;
  }

  toDOM(): Node {
    const marker = document.createElement(this.hunk.uncommitted ? "span" : "button");
    if (marker instanceof HTMLButtonElement) marker.type = "button";
    const date = this.hunk.uncommitted || this.hunk.authoredAt <= 0
      ? this.copy.gitBlameLocal
      : formatGitBlameDate(this.hunk.authoredAt);
    marker.className = "cm-git-blame-marker";
    const author = document.createElement("span");
    author.className = "cm-git-blame-author";
    author.textContent = this.hunk.uncommitted ? date : this.hunk.authorName;
    const time = document.createElement("span");
    time.className = "cm-git-blame-time";
    time.textContent = this.hunk.uncommitted ? "" : date;
    marker.append(time, author);
    marker.title = blameDetails(this.hunk, this.copy);
    if (!this.hunk.uncommitted) marker.addEventListener("click", () => this.openCommit(this.hunk));
    return marker;
  }
}

function blameLineEndPresentation(
  hunks: readonly GitBlameHunk[],
  copy: GitBlameCopy,
  openCommit: OpenGitBlameCommit,
  sourceLine: SourceLineMapper,
): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = blameLineEndDecorations(view, hunks, copy, openCommit, sourceLine);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet || update.focusChanged) {
        this.decorations = blameLineEndDecorations(update.view, hunks, copy, openCommit, sourceLine);
      }
    }
  }, { decorations: (plugin) => plugin.decorations });
}

function blameLineEndDecorations(
  view: EditorView,
  hunks: readonly GitBlameHunk[],
  copy: GitBlameCopy,
  openCommit: OpenGitBlameCommit,
  sourceLine: SourceLineMapper,
): DecorationSet {
  const documentLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  const mappedLine = sourceLine(documentLine);
  const hunk = mappedLine === null ? null : blameHunkAt(hunks, mappedLine);
  if (!hunk) return Decoration.none;
  return Decoration.set([
    Decoration.widget({
      widget: new GitBlameLineEndWidget(hunk, copy, openCommit),
      side: 1,
    }).range(view.state.doc.line(documentLine).to),
  ]);
}

class GitBlameLineEndWidget extends WidgetType {
  constructor(
    private readonly hunk: GitBlameHunk,
    private readonly copy: GitBlameCopy,
    private readonly openCommit: OpenGitBlameCommit,
  ) {
    super();
  }

  eq(other: GitBlameLineEndWidget): boolean {
    return this.hunk === other.hunk && this.copy === other.copy && this.openCommit === other.openCommit;
  }

  toDOM(): HTMLElement {
    const marker = document.createElement(this.hunk.uncommitted ? "span" : "button");
    if (marker instanceof HTMLButtonElement) marker.type = "button";
    marker.className = `cm-git-blame-line-end${this.hunk.uncommitted ? " cm-git-blame-uncommitted" : ""}`;
    marker.textContent = compactBlameText(this.hunk, this.copy);
    marker.title = blameDetails(this.hunk, this.copy);
    marker.setAttribute("aria-label", marker.textContent);
    if (!this.hunk.uncommitted) {
      marker.addEventListener("pointerdown", preserveLineEndAction);
      marker.addEventListener("click", () => this.openCommit(this.hunk));
    }
    return marker;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function preserveLineEndAction(event: Event): void {
  // A blurred editor recomputes view decorations when a pointer focuses it.
  // Keep this widget mounted until the subsequent click activates the commit.
  event.preventDefault();
  event.stopPropagation();
}

function compactBlameText(hunk: GitBlameHunk, copy: GitBlameCopy): string {
  return hunk.uncommitted || hunk.authoredAt <= 0
    ? copy.gitBlameLocal
    : `${hunk.authorName} · ${formatGitBlameDateTime(hunk.authoredAt)}`;
}

function blameDetails(hunk: GitBlameHunk, copy: GitBlameCopy): string {
  return copy.gitBlameDetails(
    hunk.authorName,
    hunk.authorEmail,
    hunk.authoredAt > 0 ? formatGitBlameDateTime(hunk.authoredAt) : copy.gitBlameLocal,
    hunk.oid,
    hunk.summary,
  );
}

class DiffLineNumberMarker extends GutterMarker {
  constructor(
    readonly number: string,
    readonly documentLine: number | null,
  ) {
    super();
  }

  eq(other: DiffLineNumberMarker): boolean {
    return other.number === this.number && other.documentLine === this.documentLine;
  }

  toDOM(): Node {
    const number = document.createElement("span");
    number.className = "cm-line-number-value";
    number.textContent = this.number;
    if (this.documentLine !== null) number.dataset.documentLine = String(this.documentLine);
    return number;
  }
}

function maxLineNumber(lines: number): number {
  let maximum = 9;
  while (maximum < lines) maximum = maximum * 10 + 9;
  return maximum;
}

function blameTone(oid: string): number {
  const suffix = Number.parseInt(oid.slice(-2), 16);
  return Number.isFinite(suffix) ? suffix % 4 : 0;
}
