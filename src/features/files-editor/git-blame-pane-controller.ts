import { Compartment, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { GitBlameResult } from "../../models.ts";
import {
  gitBlamePresentation,
  type GitBlameAvailability,
  type GitBlameCopy,
  type GitBlameRuntime,
  type GitBlameSource,
} from "./editor-gutter.ts";
import type { GitBlameDisplayMode } from "../../preferences.ts";

export interface GitBlamePaneTarget {
  readonly identity: string;
  readonly source: GitBlameSource | null;
  readonly unavailableReason: string | null;
  readonly load?: () => Promise<GitBlameResult>;
  readonly autoLoad?: boolean;
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

/** Owns automatic Git Blame loading and its request/result lifecycle for any number of panes. */
export class GitBlamePaneController {
  private readonly states = new Map<string, PaneState>();
  private readonly bindings: PaneBinding[] = [];
  private readonly runtime: GitBlameRuntime;
  private copy: GitBlameCopy;
  private displayMode: GitBlameDisplayMode = "line-number-hover";

  constructor(
    runtime: GitBlameRuntime,
    copy: GitBlameCopy,
  ) {
    this.runtime = runtime;
    this.copy = copy;
  }

  setCopy(copy: GitBlameCopy): void {
    if (this.copy === copy) return;
    this.copy = copy;
    for (const [pane, state] of this.states) {
      if (state.result) this.install(pane, state.result);
    }
  }

  setDisplayMode(displayMode: GitBlameDisplayMode): void {
    if (this.displayMode === displayMode) return;
    this.displayMode = displayMode;
    for (const [pane, state] of this.states) {
      if (state.result) this.install(pane, state.result);
    }
  }

  setTarget(pane: string, target: GitBlamePaneTarget): void {
    const current = this.states.get(pane);
    if (current?.target.identity === target.identity) {
      current.target = target;
      if (this.hasBinding(pane)) void this.ensure(pane);
      return;
    }
    if (current) this.clear(pane);
    this.states.set(pane, { target, result: null, loading: false, generation: 0 });
    if (this.hasBinding(pane)) void this.ensure(pane);
  }

  extensions(
    pane: string,
    compartment: Compartment,
    sourceLine: (documentLine: number) => number | null = (line) => line,
  ): Extension[] {
    const result = this.states.get(pane)?.result ?? null;
    return [
      compartment.of(result
        ? gitBlamePresentation(result, this.copy, this.displayMode, sourceLine)
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
    const state = this.states.get(pane);
    if (state?.result) this.install(pane, state.result);
    else void this.ensure(pane);
  }

  invalidate(pane: string): void {
    if (this.states.has(pane)) this.clear(pane);
  }

  destroy(): void {
    for (const state of this.states.values()) {
      state.generation += 1;
      state.loading = false;
      state.result = null;
    }
    this.states.clear();
    this.bindings.length = 0;
  }

  private async ensure(pane: string): Promise<void> {
    const state = this.states.get(pane);
    if (!state) return;
    if (state.result || state.loading || state.target.autoLoad === false) return;
    if (!state.target.source && !state.target.load) return;
    const identity = state.target.identity;
    const generation = ++state.generation;
    state.loading = true;
    try {
      const result = state.target.load
        ? await state.target.load()
        : await this.runtime.load(state.target.source!);
      const current = this.states.get(pane);
      if (!current || current.generation !== generation || current.target.identity !== identity) return;
      current.loading = false;
      current.result = result;
      this.install(pane, result);
      if (result.truncated) {
        const lines = result.hunks.reduce((total, hunk) => total + hunk.lineCount, 0);
        this.runtime.status(this.copy.gitBlameLimited(lines), "warning");
      }
    } catch (error) {
      const current = this.states.get(pane);
      if (!current || current.generation !== generation) return;
      current.loading = false;
      this.runtime.error(error);
    }
  }

  private clear(pane: string): void {
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
  }

  private install(pane: string, result: GitBlameResult): void {
    for (const binding of this.bindings) {
      if (binding.pane !== pane) continue;
      binding.view.dispatch({
        effects: binding.compartment.reconfigure(
          gitBlamePresentation(
            result,
            this.copy,
            this.displayMode,
            binding.sourceLine,
          ),
        ),
      });
    }
  }

  private hasBinding(pane: string): boolean {
    return this.bindings.some((binding) => binding.pane === pane);
  }
}
