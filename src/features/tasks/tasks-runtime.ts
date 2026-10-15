import type { TasksController } from "./tasks-controller.ts";
import type { TaskPresentation, TasksState, TasksWorkspaceIdentity } from "./tasks-model.ts";
import {
  buildTaskTree,
  TASK_TREE_ROOT_KEY,
  taskTreeBranchKeys,
  taskTreeDefaultExpandedKeys,
} from "./tasks-tree.ts";
import { renderTasksView, TASKS_RENDER_BATCH_SIZE, type TasksCopy } from "./tasks-view.ts";

export interface TasksRuntimeOptions {
  readonly copy?: () => TasksCopy;
  readonly runTask?: (taskKey: string, identity: TasksWorkspaceIdentity) => void | Promise<void>;
  readonly revealOutput?: (taskKey: string, identity: TasksWorkspaceIdentity) => void;
  readonly refresh?: (identity: TasksWorkspaceIdentity) => void | Promise<void>;
  readonly cancel?: (identity: TasksWorkspaceIdentity) => void | Promise<void>;
  readonly error?: (error: unknown) => void;
}

export class TasksRuntime {
  private readonly release: () => void;
  private abortController: AbortController | null = null;
  private disposed = false;
  private readonly root: HTMLElement;
  private readonly controller: TasksController;
  private readonly options: TasksRuntimeOptions;
  private visibleLimit = TASKS_RENDER_BATCH_SIZE;
  private expandedTreeNodes = new Set<string>([TASK_TREE_ROOT_KEY]);
  private treeExpansionTouched = false;
  private presentation: TaskPresentation = "all-tasks-tree";

  constructor(
    root: HTMLElement,
    controller: TasksController,
    options: TasksRuntimeOptions = {},
  ) {
    this.root = root;
    this.controller = controller;
    this.options = options;
    this.release = controller.subscribe((change) => {
      if (change.reason === "workspace") {
        this.expandedTreeNodes = new Set([TASK_TREE_ROOT_KEY]);
        this.treeExpansionTouched = false;
      }
      if (change.reason === "providers") this.reconcileExpandedTree(change.state);
      if (change.reason === "workspace" || change.reason === "providers" || change.reason === "query") this.visibleLimit = TASKS_RENDER_BATCH_SIZE;
      this.render();
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
    const copy = this.options.copy?.();
    host.innerHTML = renderTasksView(this.controller.state, copy, this.visibleLimit, this.expandedTreeNodes, this.presentation);
    syncTasksHeaderRefresh(this.root, this.controller.state, copy);
    this.bind();
    restoreTasksFocus(host, focus);
  }

  setPresentation(presentation: TaskPresentation): boolean {
    if (this.presentation === presentation) return false;
    this.presentation = presentation;
    this.render();
    return true;
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
    this.root.querySelector<HTMLButtonElement>("#tasks-header-refresh")
      ?.addEventListener("click", () => { void this.refresh(); }, { signal });
    host.addEventListener("input", (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.matches("[data-tasks-query]")) this.controller.setQuery(target.value);
    }, { signal });
    host.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const action = target.closest<HTMLElement>("[data-tasks-action]")?.dataset.tasksAction;
      if (action === "refresh") void this.refresh();
      else if (action === "cancel") void this.cancel();
      else if (action === "show-more") this.showMore();
      const treeToggle = target.closest<HTMLElement>("[data-task-tree-toggle]")?.dataset.taskTreeToggle;
      if (treeToggle) this.toggleTreeNode(treeToggle);
      const row = target.closest<HTMLElement>("[data-task-key]");
      if (row) {
        const taskKey = row.dataset.taskKey ?? "";
        this.controller.selectKey(taskKey);
        const taskAction = target.closest<HTMLElement>("[data-task-action]")?.dataset.taskAction;
        if (taskAction === "run" || taskAction === "retry") void this.run(taskKey);
        else if (taskAction === "reveal-output") this.revealOutput(taskKey);
      }
    }, { signal });
    host.addEventListener("focusin", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const taskKey = target.closest<HTMLElement>("[data-task-key]")?.dataset.taskKey;
      if (taskKey) this.controller.selectKey(taskKey);
    }, { signal });
    host.addEventListener("keydown", (event) => {
      const keyboard = event as KeyboardEvent;
      const target = event.target;
      if (target instanceof Element) {
        const treeRow = target.closest<HTMLElement>("[data-task-tree-row]");
        if (treeRow && this.handleTreeNavigation(host, treeRow, keyboard)) return;
        if (target.matches("[role=tree]") && ["ArrowDown", "ArrowUp", "Home", "End"].includes(keyboard.key)) {
          const rows = Array.from(host.querySelectorAll<HTMLElement>("[data-task-tree-row]"));
          const first = keyboard.key === "ArrowUp" || keyboard.key === "End" ? rows.at(-1) : rows[0];
          if (first) {
            keyboard.preventDefault();
            this.focusTreeRow(first);
            return;
          }
        }
      }
      if (keyboard.key === "ArrowDown") {
        if (this.controller.state.selectedIndex + 1 >= this.visibleLimit && this.visibleLimit < this.controller.state.visibleEntries.length) {
          this.visibleLimit += TASKS_RENDER_BATCH_SIZE;
        }
        if (this.controller.moveSelection(1)) keyboard.preventDefault();
      }
      else if (keyboard.key === "ArrowUp" && this.controller.moveSelection(-1)) keyboard.preventDefault();
      else if (keyboard.key === "Enter") {
        const task = this.controller.selectedTask();
        if (task?.task.runnable && this.controller.state.status !== "loading") { keyboard.preventDefault(); void this.run(task.key); }
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

  private async cancel(): Promise<void> {
    const identity = this.controller.state.identity;
    if (!identity || !this.options.cancel) return;
    try { await this.options.cancel(identity); } catch (error) { this.options.error?.(error); }
  }

  private showMore(): void {
    this.visibleLimit = Math.min(
      this.visibleLimit + TASKS_RENDER_BATCH_SIZE,
      this.controller.state.visibleEntries.length,
    );
    this.render();
  }

  private toggleTreeNode(key: string): void {
    if (this.controller.state.query.trim()) return;
    this.treeExpansionTouched = true;
    if (this.expandedTreeNodes.has(key)) this.expandedTreeNodes.delete(key);
    else this.expandedTreeNodes.add(key);
    this.visibleLimit = TASKS_RENDER_BATCH_SIZE;
    this.render();
  }

  private reconcileExpandedTree(state: TasksState): void {
    const tree = buildTaskTree(state.entries, state.identity?.root ?? "", this.options.copy?.().title ?? "Tasks");
    const available = taskTreeBranchKeys(tree);
    this.expandedTreeNodes = this.treeExpansionTouched
      ? new Set([...this.expandedTreeNodes].filter((key) => available.has(key)))
      : taskTreeDefaultExpandedKeys(tree);
    this.expandedTreeNodes.add(TASK_TREE_ROOT_KEY);
  }

  private handleTreeNavigation(host: HTMLElement, row: HTMLElement, event: KeyboardEvent): boolean {
    const rows = Array.from(host.querySelectorAll<HTMLElement>("[data-task-tree-row]"));
    const index = rows.indexOf(row);
    if (index < 0) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      const next = event.key === "Home" ? 0
        : event.key === "End" ? rows.length - 1
          : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      event.preventDefault();
      this.focusTreeRow(rows[next] ?? row);
      return true;
    }
    const branchKey = row.dataset.taskTreeKey;
    const branch = row.hasAttribute("aria-expanded") && branchKey;
    if (event.key === "ArrowRight" && branch) {
      event.preventDefault();
      if (row.getAttribute("aria-expanded") === "false") this.toggleTreeNode(branchKey);
      else this.focusTreeRow(rows[index + 1] ?? row);
      return true;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (branch && row.getAttribute("aria-expanded") === "true" && !this.controller.state.query.trim()) {
        this.toggleTreeNode(branchKey);
      } else {
        const parentKey = row.dataset.taskTreeParent;
        const parent = parentKey ? rows.find((candidate) => candidate.dataset.taskTreeKey === parentKey) : undefined;
        if (parent) this.focusTreeRow(parent);
      }
      return true;
    }
    return false;
  }

  private focusTreeRow(row: HTMLElement): void {
    const control = row.querySelector<HTMLElement>("[data-task-tree-toggle], [data-task-action=run]");
    const target = control?.matches(":disabled") ? row : control ?? row;
    target.focus({ preventScroll: true });
    const taskKey = row.dataset.taskKey;
    if (taskKey) this.controller.selectKey(taskKey);
    row.scrollIntoView({ block: "nearest" });
  }

  private revealOutput(taskKey: string): void {
    const identity = this.controller.state.identity;
    if (identity) this.options.revealOutput?.(taskKey, identity);
  }

  private host(): HTMLElement | null { return this.root.querySelector<HTMLElement>("#tasks-tool-host"); }
}

export function syncTasksHeaderRefresh(root: ParentNode, state: TasksState, copy?: TasksCopy): void {
  const headerRefresh = root.querySelector<HTMLButtonElement>("#tasks-header-refresh");
  if (!headerRefresh) return;
  headerRefresh.disabled = state.status === "loading";
  if (!copy) return;
  headerRefresh.setAttribute("aria-label", copy.refresh);
  headerRefresh.title = copy.refresh;
}

export type TasksFocusSnapshot =
  | { readonly kind: "query"; readonly start: number | null; readonly end: number | null }
  | { readonly kind: "list" }
  | { readonly kind: "task"; readonly key: string; readonly action: string }
  | { readonly kind: "tree-node"; readonly key: string }
  | null;

export function captureTasksFocus(host: HTMLElement): TasksFocusSnapshot {
  const active = host.ownerDocument.activeElement;
  if (!(active instanceof HTMLElement) || !host.contains(active)) return null;
  if (active.matches("[data-tasks-query]")) {
    const input = active as HTMLInputElement;
    return { kind: "query", start: input.selectionStart, end: input.selectionEnd };
  }
  if (active.matches("[role=tree], [role=listbox]")) return { kind: "list" };
  const row = active.closest<HTMLElement>("[data-task-key]");
  if (row) return { kind: "task", key: row.dataset.taskKey ?? "", action: active.dataset.taskAction ?? "run" };
  const treeNode = active.closest<HTMLElement>("[data-task-tree-key]");
  if (treeNode) return { kind: "tree-node", key: treeNode.dataset.taskTreeKey ?? "" };
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
    const target = row?.querySelector<HTMLElement>(`[data-task-action="${snapshot.action}"]`) ?? row?.querySelector<HTMLElement>("[data-task-action]") ?? host.querySelector<HTMLElement>("[role=tree]");
    target?.focus({ preventScroll: true });
    return;
  }
  if (snapshot.kind === "tree-node") {
    const nodes = Array.from(host.querySelectorAll<HTMLElement>("[data-task-tree-key]"));
    const node = nodes.find((candidate) => candidate.dataset.taskTreeKey === snapshot.key);
    (node?.querySelector<HTMLElement>("[data-task-tree-toggle], [data-task-action=run]") ?? node)?.focus({ preventScroll: true });
    return;
  }
  const selected = host.querySelector<HTMLElement>('[role="treeitem"][aria-selected="true"]') ??
    host.querySelector<HTMLElement>("[role=tree]");
  selected?.focus({ preventScroll: true });
  if (selected && "scrollIntoView" in selected) selected.scrollIntoView({ block: "nearest" });
}
