import type { TasksController } from "./tasks-controller.ts";
import type { TasksWorkspaceIdentity } from "./tasks-model.ts";
import { renderTasksView, type TasksCopy } from "./tasks-view.ts";

export interface TasksRuntimeOptions {
  readonly copy?: () => TasksCopy;
  readonly runTask?: (taskKey: string, identity: TasksWorkspaceIdentity) => void | Promise<void>;
  readonly revealOutput?: (taskKey: string, identity: TasksWorkspaceIdentity) => void;
  readonly refresh?: (identity: TasksWorkspaceIdentity) => void | Promise<void>;
  readonly error?: (error: unknown) => void;
  readonly shouldRender?: () => boolean;
}

export class TasksRuntime {
  private readonly release: () => void;
  private abortController: AbortController | null = null;
  private disposed = false;
  private readonly root: HTMLElement;
  private readonly controller: TasksController;
  private readonly options: TasksRuntimeOptions;

  constructor(
    root: HTMLElement,
    controller: TasksController,
    options: TasksRuntimeOptions = {},
  ) {
    this.root = root;
    this.controller = controller;
    this.options = options;
    this.release = controller.subscribe(() => {
      if (this.options.shouldRender?.() !== false) this.render();
    });
  }

  activate(identity: TasksWorkspaceIdentity): void {
    this.controller.activate(identity);
    this.bind();
    this.render();
  }

  clear(): void {
    this.controller.clear();
    this.render();
  }

  render(): void {
    const host = this.host();
    if (!host) return;
    const focus = captureTasksFocus(host);
    host.innerHTML = renderTasksView(this.controller.state, this.options.copy?.());
    this.bind();
    restoreTasksFocus(host, focus);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController?.abort();
    this.abortController = null;
    this.release();
    this.controller.dispose();
  }

  private bind(): void {
    if (this.disposed || this.abortController) return;
    const host = this.host();
    if (!host) return;
    const controller = new AbortController();
    this.abortController = controller;
    const signal = controller.signal;
    host.addEventListener("input", (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.matches("[data-tasks-query]")) this.controller.setQuery(target.value);
    }, { signal });
    host.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const action = target.closest<HTMLElement>("[data-tasks-action]")?.dataset.tasksAction;
      if (action === "refresh") void this.refresh();
      const row = target.closest<HTMLElement>("[data-task-key]");
      if (row) {
        const taskKey = row.dataset.taskKey ?? "";
        this.controller.selectKey(taskKey);
        const taskAction = target.closest<HTMLElement>("[data-task-action]")?.dataset.taskAction;
        if (taskAction === "run" || taskAction === "retry") void this.run(taskKey);
        else if (taskAction === "reveal-output") this.revealOutput(taskKey);
      }
    }, { signal });
    host.addEventListener("keydown", (event) => {
      const keyboard = event as KeyboardEvent;
      if (keyboard.key === "ArrowDown" && this.controller.moveSelection(1)) keyboard.preventDefault();
      else if (keyboard.key === "ArrowUp" && this.controller.moveSelection(-1)) keyboard.preventDefault();
      else if (keyboard.key === "Enter") {
        const task = this.controller.selectedTask();
        if (task?.task.runnable) { keyboard.preventDefault(); void this.run(task.key); }
      }
    }, { signal });
  }

  private async run(taskKey: string): Promise<void> {
    const identity = this.controller.state.identity;
    if (!identity || !this.options.runTask) return;
    try { await this.options.runTask(taskKey, identity); } catch (error) { this.options.error?.(error); }
  }

  private async refresh(): Promise<void> {
    const identity = this.controller.state.identity;
    if (!identity || !this.options.refresh) return;
    try { await this.options.refresh(identity); } catch (error) { this.options.error?.(error); }
  }

  private revealOutput(taskKey: string): void {
    const identity = this.controller.state.identity;
    if (identity) this.options.revealOutput?.(taskKey, identity);
  }

  private host(): HTMLElement | null { return this.root.querySelector<HTMLElement>("#tasks-tool-host"); }
}

export type TasksFocusSnapshot =
  | { readonly kind: "query"; readonly start: number | null; readonly end: number | null }
  | { readonly kind: "list" }
  | { readonly kind: "task"; readonly key: string; readonly action: string }
  | null;

export function captureTasksFocus(host: HTMLElement): TasksFocusSnapshot {
  const active = host.ownerDocument.activeElement;
  if (!(active instanceof HTMLElement) || !host.contains(active)) return null;
  if (active.matches("[data-tasks-query]")) {
    const input = active as HTMLInputElement;
    return { kind: "query", start: input.selectionStart, end: input.selectionEnd };
  }
  if (active.matches("[role=option], [role=listbox]")) return { kind: "list" };
  const row = active.closest<HTMLElement>("[data-task-key]");
  if (row) return { kind: "task", key: row.dataset.taskKey ?? "", action: active.dataset.taskAction ?? "run" };
  return null;
}

export function restoreTasksFocus(host: HTMLElement, snapshot: TasksFocusSnapshot): void {
  if (!snapshot) return;
  if (snapshot.kind === "query") {
    const input = host.querySelector<HTMLInputElement>("[data-tasks-query]");
    if (!input) return;
    input.focus({ preventScroll: true });
    if (snapshot.start !== null && snapshot.end !== null) input.setSelectionRange(snapshot.start, snapshot.end);
    return;
  }
  if (snapshot.kind === "task") {
    const rows = Array.from(host.querySelectorAll<HTMLElement>("[data-task-key]"));
    const row = rows.find((candidate) => candidate.dataset.taskKey === snapshot.key);
    (row?.querySelector<HTMLElement>(`[data-task-action="${snapshot.action}"]`) ?? row?.querySelector<HTMLElement>("[data-task-action]"))?.focus({ preventScroll: true });
    return;
  }
  const selected = host.querySelector<HTMLElement>('[role="option"][aria-selected="true"]') ??
    host.querySelector<HTMLElement>("[role=listbox]");
  selected?.focus({ preventScroll: true });
  if (selected && "scrollIntoView" in selected) selected.scrollIntoView({ block: "nearest" });
}
