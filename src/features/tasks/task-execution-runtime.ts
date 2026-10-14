import type { TaskExecutionController, TaskWorkspaceIdentity } from "../../application/tasks/task-execution-controller.ts";
import type { TaskExecutionRequest } from "../../models.ts";
import type { PluginTaskExecutionResult } from "../../application/plugins/plugin-types.ts";
import { EN_US_TASK_EXECUTION_COPY, type TaskExecutionCopy } from "../../localization/task-execution-copy.ts";
import { renderTaskExecutionReview } from "./task-execution-view.ts";

export class TaskExecutionRuntime {
  private identity: TaskWorkspaceIdentity | null = null;
  private readonly unsubscribe: () => void;
  private readonly root: HTMLElement;
  private readonly controller: TaskExecutionController;
  private readonly copy: () => TaskExecutionCopy;
  private readonly listeners = new AbortController();
  private focusReturn: HTMLElement | null = null;
  private wasOpen = false;
  private finished: ((result: PluginTaskExecutionResult) => void) | null = null;
  constructor(root: HTMLElement, controller: TaskExecutionController, copy: () => TaskExecutionCopy = () => EN_US_TASK_EXECUTION_COPY) {
    this.root = root;
    this.controller = controller;
    this.copy = copy;
    this.unsubscribe = controller.subscribe((state) => { this.render(); this.observeTerminal(state); });
    root.addEventListener("click", (event) => { const target = (event.target as HTMLElement).closest<HTMLElement>("[data-task-execution-action]"); if (!target || !this.identity) return; if (target.dataset.taskExecutionAction === "confirm") void controller.confirm(this.identity).catch(() => undefined); else if (target.dataset.taskExecutionAction === "cancel") void controller.cancel(this.identity).catch(() => undefined); else if (target.dataset.taskExecutionAction === "trust") void controller.setWorkspaceTrust(this.identity, "trusted").catch(() => undefined); else if (target.dataset.taskExecutionAction === "deny") void controller.setWorkspaceTrust(this.identity, "denied").catch(() => undefined); }, { signal: this.listeners.signal });
    root.addEventListener("keydown", (event) => {
      if (!this.identity || !this.controller.state.review) return;
      if (event.key === "Escape") {
        event.preventDefault();
        void this.controller.cancel(this.identity).catch(() => undefined);
      } else if (event.key === "Tab") {
        const host = this.host();
        if (host) trapFocus(host, event);
      }
    }, { signal: this.listeners.signal });
  }
  get active(): boolean { return this.finished !== null || this.controller.state.review !== null; }
  activate(identity: TaskWorkspaceIdentity): void {
    if (this.finished) {
      const finished = this.finished;
      this.finished = null;
      finished({ status: "cancelled", outputs: [], truncated: false, error: "Task execution was superseded by a workspace change." });
    }
    this.identity = identity;
    this.controller.activateWorkspace(identity);
    this.render();
  }
  async prepare(identity: TaskWorkspaceIdentity, request: TaskExecutionRequest, finished: (result: PluginTaskExecutionResult) => void): Promise<void> {
    if (this.finished) throw new Error("A task execution review is already active.");
    this.identity = identity;
    this.finished = finished;
    try { await this.controller.prepare(identity, request); } catch (error) {
      if (this.finished === finished) this.finished = null;
      throw error;
    }
    if (this.finished !== finished) {
      return;
    }
    this.render();
  }
  render(): void {
    const host = this.host();
    if (!host) return;
    const open = this.controller.state.review !== null;
    if (open && !this.wasOpen) {
      this.focusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    if (!open && !this.wasOpen) return;
    const focusedAction = host.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.taskExecutionAction ?? null
      : null;
    this.wasOpen = open;
    host.innerHTML = renderTaskExecutionReview(this.controller.state, this.copy());
    if (!open) {
      return;
    }
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
      this.controller.clear();
      finished({ status: "cancelled", outputs: [], truncated: false, error: "Task execution was cancelled." });
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
    this.listeners.abort();
    this.unsubscribe();
    this.controller.dispose();
    this.host()?.replaceChildren();
    this.wasOpen = false;
    this.restoreFocus();
  }

  private observeTerminal(state: import("../../application/tasks/task-execution-controller.ts").TaskExecutionState): void {
    if (!this.finished || (!["succeeded", "failed", "cancelled", "crashed"].includes(state.status) && state.status !== "idle")) return;
    const finished = this.finished;
    this.finished = null;
    this.controller.clear();
    finished({ status: state.status === "idle" ? "cancelled" : state.status as "succeeded" | "failed" | "cancelled" | "crashed", outputs: state.outputs, truncated: state.outputTruncated, error: state.error });
  }

  private host(): HTMLElement | null {
    return this.root.matches("#tasks-tool-host")
      ? this.root
      : this.root.querySelector<HTMLElement>("#tasks-tool-host");
  }
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
