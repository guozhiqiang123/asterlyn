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
import { formatGitBlameDateTime } from "../../presentation/date-time.ts";
import type { GitBlameDisplayMode } from "../../preferences.ts";

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

export type DiffGutterSide = "before" | "after";

type LineNumberFormatter = (lineNumber: number, state: EditorState) => string;

export function lineNumberGutter(
  formatNumber?: (lineNumber: number) => string,
  side: DiffGutterSide = "before",
): Extension {
  return diffLineNumberGutter(
    side,
    formatNumber ? (lineNumber) => formatNumber(lineNumber) : undefined,
  );
}

/**
 * A line-number gutter that may live after the editor content. CodeMirror's
 * built-in lineNumbers helper is intentionally fixed to the `before` side;
 * split Diff layouts must use the public gutter `side` contract instead of
 * reordering sticky gutter DOM with CSS.
 */
export function diffLineNumberGutter(
  side: DiffGutterSide,
  formatNumber: LineNumberFormatter = (lineNumber) => lineNumber.toString(),
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
  });
}

export function gitBlamePresentation(
  result: GitBlameResult,
  copy: GitBlameCopy,
  mode: GitBlameDisplayMode,
  sourceLine: SourceLineMapper = (line) => line,
): Extension {
  const hunks = [...result.hunks].sort(
    (left, right) => left.finalStartLine - right.finalStartLine,
  );
  return mode === "line-end"
    ? blameLineEndPresentation(hunks, copy, sourceLine)
    : blameLineNumberHoverPresentation(hunks, copy, sourceLine);
}

function blameHunkAt(hunks: readonly GitBlameHunk[], line: number): GitBlameHunk | null {
  let low = 0;
  let high = hunks.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const hunk = hunks[middle]!;
    if (line < hunk.finalStartLine) {
      high = middle - 1;
    } else if (line >= hunk.finalStartLine + hunk.lineCount) {
      low = middle + 1;
    } else {
      return hunk;
    }
  }
  return null;
}

function blameLineEndPresentation(
  hunks: readonly GitBlameHunk[],
  copy: GitBlameCopy,
  sourceLine: SourceLineMapper,
): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = blameLineEndDecorations(view, hunks, copy, sourceLine);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet || update.focusChanged) {
        this.decorations = blameLineEndDecorations(update.view, hunks, copy, sourceLine);
      }
    }
  }, {
    decorations: (plugin) => plugin.decorations,
  });
}

function blameLineEndDecorations(
  view: EditorView,
  hunks: readonly GitBlameHunk[],
  copy: GitBlameCopy,
  sourceLine: SourceLineMapper,
): DecorationSet {
  if (!view.hasFocus) return Decoration.none;

  const documentLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  const mappedLine = sourceLine(documentLine);
  const hunk = mappedLine === null ? null : blameHunkAt(hunks, mappedLine);
  if (!hunk) return Decoration.none;

  const line = view.state.doc.line(documentLine);
  return Decoration.set([
    Decoration.widget({
      widget: new GitBlameLineEndWidget(hunk, copy),
      side: 1,
    }).range(line.to),
  ]);
}

class GitBlameLineEndWidget extends WidgetType {
  constructor(
    private readonly hunk: GitBlameHunk,
    private readonly copy: GitBlameCopy,
  ) {
    super();
  }

  eq(other: GitBlameLineEndWidget): boolean {
    return this.hunk === other.hunk && this.copy === other.copy;
  }

  toDOM(): HTMLElement {
    const marker = document.createElement("span");
    marker.className = `cm-git-blame-line-end${this.hunk.uncommitted ? " cm-git-blame-uncommitted" : ""}`;
    marker.textContent = compactBlameText(this.hunk, this.copy);
    marker.title = blameDetails(this.hunk, this.copy);
    marker.setAttribute("aria-label", marker.textContent);
    return marker;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function blameLineNumberHoverPresentation(
  hunks: readonly GitBlameHunk[],
  copy: GitBlameCopy,
  sourceLine: SourceLineMapper,
): Extension {
  return ViewPlugin.fromClass(class {
    readonly view: EditorView;
    private readonly listeners = new AbortController();
    private tooltip: HTMLDivElement | null = null;
    private target: HTMLElement | null = null;

    constructor(view: EditorView) {
      this.view = view;
      view.dom.addEventListener("mouseover", this.mouseover, { signal: this.listeners.signal });
      view.dom.addEventListener("mouseout", this.mouseout, { signal: this.listeners.signal });
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || update.geometryChanged) this.hide();
    }

    destroy(): void {
      this.listeners.abort();
      this.hide();
    }

    private readonly mouseover = (event: MouseEvent): void => {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>(".cm-line-number-value[data-document-line]")
        : null;
      if (target && this.view.dom.contains(target)) this.show(target);
    };

    private readonly mouseout = (event: MouseEvent): void => {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>(".cm-line-number-value[data-document-line]")
        : null;
      if (!target) return;
      const related = event.relatedTarget;
      if (related instanceof Node && target.contains(related)) return;
      this.hide();
    };

    show(target: HTMLElement): void {
      const documentLine = Number(target.dataset.documentLine);
      if (!Number.isInteger(documentLine)) {
        this.hide();
        return;
      }
      const mappedLine = sourceLine(documentLine);
      const hunk = mappedLine === null ? null : blameHunkAt(hunks, mappedLine);
      if (!hunk) {
        this.hide();
        return;
      }
      if (this.target === target && this.tooltip) return;
      this.hide();
      this.target = target;
      const tooltip = document.createElement("div");
      tooltip.className = `cm-git-blame-tooltip${hunk.uncommitted ? " cm-git-blame-uncommitted" : ""}`;
      tooltip.id = `cm-git-blame-tooltip-${nextBlameTooltipId++}`;
      tooltip.setAttribute("role", "tooltip");
      tooltip.title = blameDetails(hunk, copy);
      const author = document.createElement("strong");
      author.textContent = hunk.uncommitted ? copy.gitBlameLocal : hunk.authorName;
      const time = document.createElement("span");
      time.textContent = hunk.uncommitted || hunk.authoredAt <= 0
        ? ""
        : formatGitBlameDateTime(hunk.authoredAt);
      tooltip.append(author);
      if (time.textContent) tooltip.append(time);
      this.view.dom.append(tooltip);
      target.setAttribute("aria-describedby", tooltip.id);
      this.tooltip = tooltip;
      positionBlameTooltip(this.view, target, tooltip);
    }

    hide(): void {
      if (this.target && this.target.getAttribute("aria-describedby") === this.tooltip?.id) {
        this.target.removeAttribute("aria-describedby");
      }
      this.tooltip?.remove();
      this.tooltip = null;
      this.target = null;
    }
  });
}

let nextBlameTooltipId = 1;

function positionBlameTooltip(
  view: EditorView,
  target: HTMLElement,
  tooltip: HTMLElement,
): void {
  const root = view.dom.getBoundingClientRect();
  const anchor = target.getBoundingClientRect();
  const afterContent = Boolean(target.closest(".cm-diff-lineNumbers-after"));
  const gap = 8;
  const width = tooltip.offsetWidth;
  const height = tooltip.offsetHeight;
  const preferredLeft = afterContent
    ? anchor.left - root.left - width - gap
    : anchor.right - root.left + gap;
  const left = Math.max(4, Math.min(preferredLeft, root.width - width - 4));
  const preferredTop = anchor.top - root.top + (anchor.height - height) / 2;
  const top = Math.max(4, Math.min(preferredTop, root.height - height - 4));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
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
