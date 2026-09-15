import type { Extension } from "@codemirror/state";
import {
  EditorView,
  GutterMarker,
  gutter,
  lineNumbers,
} from "@codemirror/view";
import type { GitBlameHunk, GitBlameResult } from "../models.ts";

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
type OpenEditorContextMenu = (event: MouseEvent, view: EditorView) => void;

export function lineNumberGutter(
  openMenu: OpenEditorContextMenu,
  formatNumber?: (lineNumber: number) => string,
): Extension {
  return lineNumbers({
    ...(formatNumber ? { formatNumber } : {}),
    domEventHandlers: {
      contextmenu: (view, _line, event) => {
        requestContextMenu(event as MouseEvent, view, openMenu);
        return true;
      },
    },
  });
}

export function blameContentContextMenu(
  openMenu: OpenEditorContextMenu,
): Extension {
  return EditorView.domEventHandlers({
    contextmenu: (event, view) => {
      const target = event.target;
      const element = target instanceof Element
        ? target
        : target instanceof Node
          ? target.parentElement
          : null;
      if (!element?.closest(".cm-content")) return false;
      requestContextMenu(event, view, openMenu);
      return true;
    },
  });
}

export function blameGutter(
  result: GitBlameResult,
  copy: GitBlameCopy,
  openMenu: OpenEditorContextMenu,
  sourceLine: SourceLineMapper = (line) => line,
): Extension {
  const hunks = [...result.hunks].sort(
    (left, right) => left.finalStartLine - right.finalStartLine,
  );
  return gutter({
    class: "cm-git-blame-gutter",
    lineMarker: (view, line) => {
      const documentLine = view.state.doc.lineAt(line.from).number;
      const mappedLine = sourceLine(documentLine);
      if (mappedLine === null) return null;
      const hunk = blameHunkAt(hunks, mappedLine);
      return hunk ? new GitBlameMarker(hunk, copy) : null;
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

class GitBlameMarker extends GutterMarker {
  readonly elementClass: string;

  constructor(
    private readonly hunk: GitBlameHunk,
    private readonly copy: GitBlameCopy,
  ) {
    super();
    this.elementClass = hunk.uncommitted
      ? "cm-git-blame-uncommitted cm-git-blame-local"
      : `cm-git-blame-tone-${blameTone(hunk.oid)}`;
  }

  eq(other: GitBlameMarker): boolean {
    return this.hunk === other.hunk && this.copy === other.copy;
  }

  toDOM(): Node {
    const marker = document.createElement("span");
    const date = this.hunk.uncommitted || this.hunk.authoredAt <= 0
      ? this.copy.gitBlameLocal
      : compactDate(this.hunk.authoredAt);
    marker.className = "cm-git-blame-marker";
    marker.textContent = this.hunk.uncommitted
      ? this.copy.gitBlameLocal
      : `${date} ${this.hunk.authorName}`;
    marker.title = this.copy.gitBlameDetails(
      this.hunk.authorName,
      this.hunk.authorEmail,
      fullDate(this.hunk.authoredAt, this.copy.gitBlameLocal),
      this.hunk.oid,
      this.hunk.summary,
    );
    return marker;
  }
}

function blameTone(oid: string): number {
  const suffix = Number.parseInt(oid.slice(-2), 16);
  return Number.isFinite(suffix) ? suffix % 4 : 0;
}

function compactDate(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function fullDate(epochSeconds: number, fallback: string): string {
  return epochSeconds > 0 ? new Date(epochSeconds * 1000).toLocaleString() : fallback;
}
