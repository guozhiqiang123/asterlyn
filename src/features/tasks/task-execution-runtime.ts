import type {
  TaskExecutionController,
  TaskExecutionState,
  TaskWorkspaceIdentity,
} from "../../application/tasks/task-execution-controller.ts";
import type { TaskExecutionRequest } from "../../models.ts";
import type { PluginTaskExecutionResult } from "../../application/plugins/plugin-types.ts";
import { EN_US_TASK_EXECUTION_COPY, type TaskExecutionCopy } from "../../localization/task-execution-copy.ts";
import { renderTaskExecutionReview } from "./task-execution-view.ts";

export interface TaskExecutionRuntimeOptions {
  readonly retry?: (identity: TaskWorkspaceIdentity, taskKey: string) => void;
  readonly visibilityChanged?: () => void;
}

export class TaskExecutionRuntime {
  private identity: TaskWorkspaceIdentity | null = null;
  private readonly unsubscribe: () => void;
  private readonly root: HTMLElement;
  private readonly controller: TaskExecutionController;
  private readonly copy: () => TaskExecutionCopy;
  private readonly options: TaskExecutionRuntimeOptions;
  private readonly listeners = new AbortController();
  private focusReturn: HTMLElement | null = null;
  private visible = false;
  private terminalState: TaskExecutionState | null = null;
  private finished: ((result: PluginTaskExecutionResult) => void) | null = null;

  constructor(
    root: HTMLElement,
    controller: TaskExecutionController,
    copy: () => TaskExecutionCopy = () => EN_US_TASK_EXECUTION_COPY,
    options: TaskExecutionRuntimeOptions = {},
  ) {
    this.root = root;
    this.controller = controller;
    this.copy = copy;
    this.options = options;
    this.unsubscribe = controller.subscribe((state) => {
      this.observeTerminal(state);
      this.render();
    });
    root.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-task-execution-action]");
      if (!target || !this.identity) return;
      const action = target.dataset.taskExecutionAction;
      if (action === "confirm") void controller.confirm(this.identity).catch((error) => this.fail(error));
      else if (action === "cancel") void controller.cancel(this.identity).catch((error) => this.fail(error));
      else if (action === "trust") void controller.setWorkspaceTrust(this.identity, "trusted").catch((error) => this.fail(error));
      else if (action === "deny") void controller.setWorkspaceTrust(this.identity, "denied").catch((error) => this.fail(error));
      else if (action === "close") this.dismiss();
      else if (action === "retry") this.retry();
    }, { signal: this.listeners.signal });
    root.addEventListener("keydown", (event) => {
      if (!this.identity || !this.visible) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (isTerminal(this.displayState())) this.dismiss();
        else void this.controller.cancel(this.identity).catch((error) => this.fail(error));
      } else if (event.key === "Tab") {
        const host = this.host();
        if (host) trapFocus(host, event);
      }
    }, { signal: this.listeners.signal });
  }

  get active(): boolean { return this.visible || this.finished !== null; }

  activate(identity: TaskWorkspaceIdentity): void {
    if (this.finished) {
      const finished = this.finished;
      this.finished = null;
      finished({ status: "cancelled", outputs: [], truncated: false, error: "Task execution was superseded by a workspace change." });
    }
    this.identity = identity;
    this.visible = false;
    this.terminalState = null;
    this.controller.activateWorkspace(identity);
    this.render();
  }

  async prepare(
    identity: TaskWorkspaceIdentity,
    request: TaskExecutionRequest,
    finished: (result: PluginTaskExecutionResult) => void,
  ): Promise<void> {
    if (this.finished) throw new Error("A task execution review is already active.");
    this.identity = identity;
    this.finished = finished;
    this.terminalState = null;
    this.open();
    try {
      await this.controller.prepare(identity, request);
    } catch (error) {
      if (this.finished === finished) this.finished = null;
      this.visible = false;
      this.options.visibilityChanged?.();
      throw error;
    }
    if (this.finished === finished) this.render();
  }

  reveal(taskKey: string, identity: TaskWorkspaceIdentity): boolean {
    const review = this.terminalState?.review;
    if (!review || !sameIdentity(this.identity, identity) || executionTaskKey(review) !== taskKey) return false;
    this.open();
    this.render();
    return true;
  }

  render(): void {
    const host = this.host();
    if (!host) return;
    const state = this.displayState();
    if (!this.visible || !state?.review) {
      if (host.querySelector(".task-execution-review")) host.replaceChildren();
      return;
    }
    const focusedAction = host.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.taskExecutionAction ?? null
      : null;
    host.innerHTML = renderTaskExecutionReview(state, this.copy());
    queueMicrotask(() => {
      const preferred = focusedAction
        ? host.querySelector<HTMLElement>(`[data-task-execution-action="${focusedAction}"]`)
        : null;
      (preferred ?? host.querySelector<HTMLElement>("button:not([disabled])"))?.focus();
    });
  }

  async cancel(identity: TaskWorkspaceIdentity): Promise<void> {
    if (this.finished && this.controller.state.status === "idle") {
      const finished = this.finished;
      this.finished = null;
      this.visible = false;
      finished({ status: "cancelled", outputs: [], truncated: false, error: "Task execution was cancelled." });
      this.options.visibilityChanged?.();
      return;
    }
    await this.controller.cancel(identity);
  }

  restoreFocus(fallback?: HTMLElement | null): void {
    const target = this.focusReturn;
    this.focusReturn = null;
    queueMicrotask(() => {
      if (target?.isConnected) target.focus();
      else fallback?.focus();
    });
  }

  dispose(): void {
    if (this.finished) {
      const finished = this.finished;
      this.finished = null;
      finished({ status: "cancelled", outputs: [], truncated: false, error: "Task execution was disposed." });
    }
    this.visible = false;
    this.terminalState = null;
    this.listeners.abort();
    this.unsubscribe();
    this.controller.dispose();
    this.host()?.replaceChildren();
    this.restoreFocus();
  }

  private open(): void {
    if (!this.visible) {
      this.focusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.visible = true;
      this.options.visibilityChanged?.();
    }
  }

  private dismiss(): void {
    const identity = this.identity;
    if (!identity || !isTerminal(this.displayState())) return;
    this.visible = false;
    this.controller.dismiss(identity);
    this.options.visibilityChanged?.();
    const fallback = this.root.querySelector<HTMLElement>("[data-tasks-action=refresh]");
    this.restoreFocus(fallback);
  }

  private retry(): void {
    const identity = this.identity;
    const review = this.terminalState?.review;
    if (!identity || !review) return;
    const taskKey = executionTaskKey(review);
    this.dismiss();
    queueMicrotask(() => this.options.retry?.(identity, taskKey));
  }

  private fail(error: unknown): void {
    const identity = this.identity;
    if (!identity) return;
    const localized = error instanceof Error && error.message.includes("already running for this workspace")
      ? new Error(this.copy().busy)
      : error;
    try { this.controller.fail(identity, localized); }
    catch { /* a stale failure cannot replace the current workspace */ }
  }

  private observeTerminal(state: TaskExecutionState): void {
    if (!this.finished) return;
    if (state.status === "idle") {
      const finished = this.finished;
      this.finished = null;
      this.visible = false;
      finished({ status: "cancelled", outputs: [], truncated: false, error: "Task execution was cancelled." });
      this.options.visibilityChanged?.();
      const fallback = this.root.querySelector<HTMLElement>("[data-tasks-action=refresh]");
      this.restoreFocus(fallback);
      return;
    }
    if (!isTerminal(state)) return;
    this.terminalState = state;
    const finished = this.finished;
    this.finished = null;
    finished({
      status: state.status,
      outputs: state.outputs,
      truncated: state.outputTruncated,
      error: state.error,
    });
  }

  private displayState(): TaskExecutionState | null {
    return this.controller.state.review ? this.controller.state : this.terminalState;
  }

  private host(): HTMLElement | null {
    return this.root.matches("#tasks-tool-host")
      ? this.root
      : this.root.querySelector<HTMLElement>("#tasks-tool-host");
  }
}

function isTerminal(state: TaskExecutionState | null): state is TaskExecutionState & { readonly status: PluginTaskExecutionResult["status"] } {
  return state !== null && (state.status === "succeeded" || state.status === "failed" || state.status === "cancelled" || state.status === "crashed");
}

function executionTaskKey(review: NonNullable<TaskExecutionState["review"]>): string {
  return `${review.pluginId}.${review.providerId}:${review.taskId}`;
}

function sameIdentity(left: TaskWorkspaceIdentity | null, right: TaskWorkspaceIdentity): boolean {
  return left?.root === right.root && left.generation === right.generation;
}

function trapFocus(host: HTMLElement, event: KeyboardEvent): void {
  const focusable = Array.from(host.querySelectorAll<HTMLElement>("button:not([disabled])"));
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
