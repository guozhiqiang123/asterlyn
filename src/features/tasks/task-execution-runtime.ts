import type { TaskExecutionController, TaskWorkspaceIdentity } from "../../application/tasks/task-execution-controller.ts";
import { EN_US_TASK_EXECUTION_COPY, type TaskExecutionCopy } from "../../localization/task-execution-copy.ts";
import { renderTaskExecutionReview } from "./task-execution-view.ts";

export class TaskExecutionRuntime {
  private identity: TaskWorkspaceIdentity | null = null;
  private readonly unsubscribe: () => void;
  private readonly host: HTMLElement;
  private readonly controller: TaskExecutionController;
  private readonly copy: () => TaskExecutionCopy;
  private readonly listeners = new AbortController();
  private focusReturn: HTMLElement | null = null;
  private wasOpen = false;
  constructor(host: HTMLElement, controller: TaskExecutionController, copy: () => TaskExecutionCopy = () => EN_US_TASK_EXECUTION_COPY) {
    this.host = host;
    this.controller = controller;
    this.copy = copy;
    this.unsubscribe = controller.subscribe(() => this.render());
    host.addEventListener("click", (event) => { const target = (event.target as HTMLElement).closest<HTMLElement>("[data-task-execution-action]"); if (!target || !this.identity) return; if (target.dataset.taskExecutionAction === "confirm") void controller.confirm(this.identity).catch(() => undefined); else if (target.dataset.taskExecutionAction === "cancel") void controller.cancel(this.identity).catch(() => undefined); else if (target.dataset.taskExecutionAction === "trust") void controller.setWorkspaceTrust(this.identity, "trusted").catch(() => undefined); else if (target.dataset.taskExecutionAction === "deny") void controller.setWorkspaceTrust(this.identity, "denied").catch(() => undefined); }, { signal: this.listeners.signal });
    host.addEventListener("keydown", (event) => {
      if (!this.identity || !this.controller.state.review) return;
      if (event.key === "Escape") {
        event.preventDefault();
        void this.controller.cancel(this.identity).catch(() => undefined);
      } else if (event.key === "Tab") {
        trapFocus(this.host, event);
      }
    }, { signal: this.listeners.signal });
  }
  activate(identity: TaskWorkspaceIdentity): void { this.identity = identity; this.controller.activateWorkspace(identity); this.render(); }
  render(): void {
    const open = this.controller.state.review !== null;
    if (open && !this.wasOpen) {
      this.focusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    const focusedAction = this.host.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.taskExecutionAction ?? null
      : null;
    this.wasOpen = open;
    this.host.innerHTML = renderTaskExecutionReview(this.controller.state, this.copy());
    if (!open) {
      this.restoreFocus();
      return;
    }
    queueMicrotask(() => {
      const preferred = focusedAction
        ? this.host.querySelector<HTMLElement>(`[data-task-execution-action="${focusedAction}"]`)
        : null;
      (preferred ?? this.host.querySelector<HTMLElement>("button:not([disabled])"))?.focus();
    });
  }
  dispose(): void {
    this.listeners.abort();
    this.unsubscribe();
    this.controller.dispose();
    this.host.replaceChildren();
    this.wasOpen = false;
    this.restoreFocus();
  }

  private restoreFocus(): void {
    const target = this.focusReturn;
    this.focusReturn = null;
    if (target) queueMicrotask(() => target.isConnected && target.focus());
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
