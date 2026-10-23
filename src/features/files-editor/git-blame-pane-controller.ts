import { Compartment, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { GitBlameResult } from "../../models.ts";
import {
  NOOP_CONTEXT_MENU_PORT,
  type ContextMenuPort,
} from "../../shared/context-menu/context-menu-model.ts";
import { gitBlameContextSession } from "./editor-gutter-context-actions.ts";
import {
  editorGutterContextMenu,
  gitBlamePresentation,
  type GitBlameAvailability,
  type GitBlameCopy,
  type GitBlameRuntime,
  type GitBlameSource,
  type OpenEditorContextMenu,
} from "./editor-gutter.ts";

export interface GitBlamePaneTarget {
  readonly identity: string;
  readonly source: GitBlameSource | null;
  readonly navigationSource?: GitBlameSource | null;
  readonly unavailableReason: string | null;
  readonly load?: () => Promise<GitBlameResult>;
  readonly autoLoad?: boolean;
}

interface PaneState {
  target: GitBlamePaneTarget;
  result: GitBlameResult | null;
  loading: boolean;
  generation: number;
  gutterVisible: boolean;
  requested: boolean;
}

interface PaneBinding {
  readonly pane: string;
  readonly view: EditorView;
  readonly compartment: Compartment;
  readonly sourceLine: (documentLine: number) => number | null;
}

export function sourceBlameTarget(
  availability: GitBlameAvailability,
  identityPrefix = "source",
): GitBlamePaneTarget {
  const source = availability.source;
  return {
    identity: source
      ? [
          identityPrefix,
          source.repositoryRoot,
          source.repositoryId,
          source.path,
          source.commitOid ?? "worktree",
          source.parent ? "parent" : "exact",
        ].join("\0")
      : `${identityPrefix}\0unavailable\0${availability.unavailableReason ?? ""}`,
    source,
    unavailableReason: availability.unavailableReason,
  };
}

/** Shares source results between automatic line-end metadata and optional gutters. */
export class GitBlamePaneController {
  private readonly states = new Map<string, PaneState>();
  private readonly bindings: PaneBinding[] = [];

  constructor(
    private readonly runtime: GitBlameRuntime,
    private copy: GitBlameCopy,
    private readonly contextMenu: ContextMenuPort = NOOP_CONTEXT_MENU_PORT,
    private readonly ownerId = "editor.git-blame",
  ) {}

  setCopy(copy: GitBlameCopy): void {
    if (this.copy === copy) return;
    this.copy = copy;
    for (const [pane, state] of this.states) {
      if (state.result) this.install(pane, state.result);
    }
  }

  setTarget(pane: string, target: GitBlamePaneTarget): void {
    const current = this.states.get(pane);
    if (current?.target.identity === target.identity) {
      current.target = target;
      return;
    }
    if (current) this.clear(pane);
    this.states.set(pane, {
      target, result: null, loading: false, generation: 0, gutterVisible: false, requested: false,
    });
    for (const binding of this.bindings) {
      if (binding.pane === pane) this.requestInline(pane, binding.view);
    }
  }

  extensions(
    pane: string,
    compartment: Compartment,
    sourceLine: (documentLine: number) => number | null = (line) => line,
  ): Extension[] {
    const state = this.states.get(pane);
    const result = state?.result ?? null;
    return [
      editorGutterContextMenu(this.menu(pane)),
      EditorView.updateListener.of((update) => {
        if (update.focusChanged || update.selectionSet) this.requestInline(pane, update.view);
      }),
      compartment.of(result
        ? this.presentation(pane, result, sourceLine)
        : []),
    ];
  }

  register(
    pane: string,
    view: EditorView,
    compartment: Compartment,
    sourceLine: (documentLine: number) => number | null = (line) => line,
  ): void {
    this.bindings.push({ pane, view, compartment, sourceLine });
    this.install(pane, this.states.get(pane)?.result ?? null);
    this.requestInline(pane, view);
  }

  unregister(view: EditorView): void {
    for (let index = this.bindings.length - 1; index >= 0; index -= 1) {
      if (this.bindings[index]!.view === view) this.bindings.splice(index, 1);
    }
    this.contextMenu.close(this.ownerId);
  }

  menu(pane: string): OpenEditorContextMenu {
    return (event, view) => this.openMenu(pane, event, view);
  }

  invalidate(pane: string): void {
    if (this.states.has(pane)) this.clear(pane);
  }

  destroy(): void {
    this.contextMenu.close(this.ownerId);
    for (const state of this.states.values()) {
      state.generation += 1;
      state.loading = false;
      state.result = null;
    }
    this.states.clear();
    this.bindings.length = 0;
  }

  private openMenu(pane: string, event: MouseEvent, view: EditorView): void {
    const state = this.states.get(pane);
    if (!state) return;
    const identity = state.target.identity;
    const generation = state.generation;
    const active = state.gutterVisible;
    const loading = state.loading;
    this.contextMenu.open(
      { x: event.clientX, y: event.clientY },
      gitBlameContextSession(this.ownerId, {
        active,
        loading,
        enabled: state.target.source !== null || state.target.load !== undefined,
        unavailableReason: state.target.unavailableReason,
        copy: this.copy,
        isCurrent: () => {
          const current = this.states.get(pane);
          return Boolean(
            current &&
            current.target.identity === identity &&
            current.generation === generation &&
            current.gutterVisible === active &&
            current.loading === loading &&
            this.bindings.some((binding) => binding.pane === pane && binding.view === view),
          );
        },
        toggle: () => this.toggle(pane),
        blocked: (reason) => this.runtime.status(reason, "warning"),
        restoreFocus: () => {
          if (this.bindings.some((binding) => binding.pane === pane && binding.view === view)) {
            view.focus();
          }
        },
      }),
    );
  }

  private async toggle(pane: string): Promise<void> {
    const state = this.states.get(pane);
    if (!state) return;
    if (state.gutterVisible) {
      state.gutterVisible = false;
      this.install(pane, state.result);
      this.runtime.status(this.copy.gitBlameHidden, "information");
      return;
    }
    if (!state.target.source && !state.target.load) return;
    state.gutterVisible = true;
    if (state.result) {
      this.install(pane, state.result);
      return;
    }
    await this.load(pane, true);
  }

  private requestInline(pane: string, view: EditorView): void {
    if (!view.hasFocus) return;
    const state = this.states.get(pane);
    if (!state || state.target.autoLoad === false || state.requested || state.result || state.loading) return;
    queueMicrotask(() => {
      if (this.states.get(pane) === state && this.bindings.some((binding) =>
        binding.pane === pane && binding.view === view && view.hasFocus
      )) void this.load(pane, false);
    });
  }

  private async load(pane: string, report: boolean): Promise<void> {
    const state = this.states.get(pane);
    if (!state || state.loading || state.result || (!report && state.requested)) return;
    if (!state.target.source && !state.target.load) return;
    const identity = state.target.identity;
    const generation = ++state.generation;
    state.loading = true;
    state.requested = true;
    if (report) this.runtime.status(this.copy.loadingGitBlame, "information");
    try {
      const result = state.target.load
        ? await state.target.load()
        : await this.runtime.load(state.target.source!);
      const current = this.states.get(pane);
      if (current !== state || current.generation !== generation || current.target.identity !== identity) return;
      current.loading = false;
      current.result = result;
      this.install(pane, result);
      const lines = result.hunks.reduce((total, hunk) => total + hunk.lineCount, 0);
      if (report) this.runtime.status(
        result.truncated ? this.copy.gitBlameLimited(lines) : this.copy.gitBlameLoaded(lines),
        result.truncated ? "warning" : "information",
      );
    } catch (error) {
      const current = this.states.get(pane);
      if (current !== state || current.generation !== generation) return;
      current.loading = false;
      current.gutterVisible = false;
      if (report) this.runtime.error(error);
    }
  }

  private clear(pane: string): void {
    this.contextMenu.close(this.ownerId);
    const state = this.states.get(pane);
    if (!state) return;
    state.generation += 1;
    state.loading = false;
    state.result = null;
    state.gutterVisible = false;
    state.requested = true;
    for (const binding of this.bindings) {
      if (binding.pane === pane) {
        binding.view.dispatch({ effects: binding.compartment.reconfigure([]) });
      }
    }
  }

  private install(pane: string, result: GitBlameResult | null): void {
    for (const binding of this.bindings) {
      if (binding.pane !== pane) continue;
      binding.view.dispatch({
        effects: binding.compartment.reconfigure(
          result ? this.presentation(pane, result, binding.sourceLine) : [],
        ),
      });
    }
  }

  private presentation(
    pane: string,
    result: GitBlameResult,
    sourceLine: (documentLine: number) => number | null,
  ): Extension {
    return gitBlamePresentation(
      result,
      this.copy,
      this.menu(pane),
      (hunk) => {
        const target = this.states.get(pane)?.target;
        const source = target?.navigationSource ?? target?.source;
        if (source && !hunk.uncommitted) this.runtime.openCommit(source, hunk);
      },
      sourceLine,
      this.states.get(pane)?.gutterVisible ?? false,
    );
  }
}
