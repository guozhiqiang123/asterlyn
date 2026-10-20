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
}

interface PaneState {
  target: GitBlamePaneTarget;
  result: GitBlameResult | null;
  loading: boolean;
  generation: number;
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

/** Owns the on-demand Git Blame menu and request lifecycle for any number of panes. */
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
    if (current) this.clear(pane, false);
    this.states.set(pane, { target, result: null, loading: false, generation: 0 });
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
  }

  menu(pane: string): OpenEditorContextMenu {
    return (event, view) => this.openMenu(pane, event, view);
  }

  invalidate(pane: string): void {
    if (this.states.has(pane)) this.clear(pane, false);
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
    const active = state.result !== null;
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
            (current.result !== null) === active &&
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
    if (state.result || state.loading) {
      this.clear(pane, true);
      return;
    }
    if (!state.target.source && !state.target.load) return;
    const identity = state.target.identity;
    const generation = ++state.generation;
    state.loading = true;
    this.runtime.status(this.copy.loadingGitBlame, "information");
    try {
      const result = state.target.load
        ? await state.target.load()
        : await this.runtime.load(state.target.source!);
      const current = this.states.get(pane);
      if (!current || current.generation !== generation || current.target.identity !== identity) return;
      current.loading = false;
      current.result = result;
      this.install(pane, result);
      const lines = result.hunks.reduce((total, hunk) => total + hunk.lineCount, 0);
      this.runtime.status(
        result.truncated ? this.copy.gitBlameLimited(lines) : this.copy.gitBlameLoaded(lines),
        result.truncated ? "warning" : "information",
      );
    } catch (error) {
      const current = this.states.get(pane);
      if (!current || current.generation !== generation) return;
      current.loading = false;
      this.runtime.error(error);
    }
  }

  private clear(pane: string, report: boolean): void {
    this.contextMenu.close(this.ownerId);
    const state = this.states.get(pane);
    if (!state) return;
    state.generation += 1;
    state.loading = false;
    state.result = null;
    for (const binding of this.bindings) {
      if (binding.pane === pane) {
        binding.view.dispatch({ effects: binding.compartment.reconfigure([]) });
      }
    }
    if (report) this.runtime.status(this.copy.gitBlameHidden, "information");
  }

  private install(pane: string, result: GitBlameResult): void {
    for (const binding of this.bindings) {
      if (binding.pane !== pane) continue;
      binding.view.dispatch({
        effects: binding.compartment.reconfigure(
          this.presentation(pane, result, binding.sourceLine),
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
    );
  }
}
