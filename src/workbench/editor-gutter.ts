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

export interface GutterBlameMenuState {
  active: boolean;
  loading: boolean;
  enabled: boolean;
  unavailableReason: string | null;
  copy: GitBlameCopy;
  toggle(): void | Promise<void>;
}

type SourceLineMapper = (documentLine: number) => number | null;

let activeMenu: { element: HTMLElement; dispose(): void } | null = null;

export function lineNumberGutter(
  openMenu: (event: MouseEvent) => GutterBlameMenuState,
  formatNumber?: (lineNumber: number) => string,
): Extension {
  return lineNumbers({
    ...(formatNumber ? { formatNumber } : {}),
    domEventHandlers: {
      contextmenu: (_view, _line, event) => {
        showGutterMenu(event as MouseEvent, openMenu(event as MouseEvent));
        return true;
      },
    },
  });
}

export function blameContentContextMenu(
  openMenu: (event: MouseEvent) => GutterBlameMenuState,
): Extension {
  return EditorView.domEventHandlers({
    contextmenu: (event) => {
      const target = event.target;
      const element = target instanceof Element
        ? target
        : target instanceof Node
          ? target.parentElement
          : null;
      if (!element?.closest(".cm-content")) return false;
      showGutterMenu(event, openMenu(event));
      return true;
    },
  });
}

export function blameGutter(
  result: GitBlameResult,
  copy: GitBlameCopy,
  openMenu: (event: MouseEvent) => GutterBlameMenuState,
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
      contextmenu: (_view, _line, event) => {
        showGutterMenu(event as MouseEvent, openMenu(event as MouseEvent));
        return true;
      },
    },
  });
}

export function closeGutterMenu(): void {
  activeMenu?.dispose();
  activeMenu = null;
}

function showGutterMenu(event: MouseEvent, state: GutterBlameMenuState): void {
  event.preventDefault();
  event.stopPropagation();
  closeGutterMenu();

  const menu = document.createElement("div");
  menu.className = "editor-gutter-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", state.copy.gutterActions);
  const item = document.createElement("button");
  item.type = "button";
  item.className = "editor-gutter-menu-item";
  item.setAttribute("role", "menuitemcheckbox");
  item.setAttribute("aria-checked", String(state.active));
  const unavailable = !state.enabled || state.loading;
  item.setAttribute("aria-disabled", String(unavailable));
  const check = document.createElement("span");
  check.className = "editor-gutter-menu-check";
  check.setAttribute("aria-hidden", "true");
  check.textContent = state.active ? "✓" : "";
  const label = document.createElement("span");
  label.textContent = state.loading
    ? state.copy.loadingGitBlame
    : state.active
      ? state.copy.hideGitBlame
      : state.copy.annotateGitBlame;
  item.append(check, label);
  menu.append(item);
  if (state.unavailableReason) {
    const reason = document.createElement("p");
    reason.className = "editor-gutter-menu-reason";
    reason.textContent = state.unavailableReason;
    menu.append(reason);
  }
  document.body.append(menu);

  const dispose = () => {
    document.removeEventListener("pointerdown", closeFromPointer, true);
    document.removeEventListener("keydown", closeFromKeyboard, true);
    window.removeEventListener("blur", closeGutterMenu);
    window.removeEventListener("resize", closeGutterMenu);
    menu.remove();
    if (activeMenu?.element === menu) activeMenu = null;
  };
  const closeFromPointer = (pointerEvent: PointerEvent) => {
    if (!menu.contains(pointerEvent.target as Node)) dispose();
  };
  const closeFromKeyboard = (keyboardEvent: KeyboardEvent) => {
    if (keyboardEvent.key !== "Escape") return;
    keyboardEvent.preventDefault();
    dispose();
  };
  item.addEventListener("click", () => {
    if (unavailable) return;
    dispose();
    void state.toggle();
  });
  document.addEventListener("pointerdown", closeFromPointer, true);
  document.addEventListener("keydown", closeFromKeyboard, true);
  window.addEventListener("blur", closeGutterMenu);
  window.addEventListener("resize", closeGutterMenu);
  activeMenu = { element: menu, dispose };

  const rectangle = menu.getBoundingClientRect();
  const left = Math.max(4, Math.min(event.clientX, window.innerWidth - rectangle.width - 4));
  const top = Math.max(4, Math.min(event.clientY, window.innerHeight - rectangle.height - 4));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  item.focus();
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
