import type { TasksController } from "./tasks-controller.ts";
import type { TaskPresentation, TasksState, TasksWorkspaceIdentity } from "./tasks-model.ts";
import {
  buildTaskTree,
  TASK_TREE_ROOT_KEY,
  taskTreeBranchKeys,
  taskTreeDefaultExpandedKeys,
} from "./tasks-tree.ts";
import { DisclosureState, type CollectionViewMode, type HierarchicalCollectionNavigationKey } from "../../presentation/hierarchical-collection.ts";
import { hierarchicalCollectionDomNavigation, hierarchicalCollectionRowElement } from "../../presentation/hierarchical-collection-dom.ts";
import { renderTasksView, taskPresentationEntries, TASKS_RENDER_BATCH_SIZE, type TasksCopy } from "./tasks-view.ts";

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
  private treeDisclosures: Record<TaskPresentation, DisclosureState> = initialDisclosures();
  private treeExpansionTouched: Record<TaskPresentation, boolean> = initialTouched();
  private presentation: TaskPresentation = "all-tasks-tree";
  private viewMode: CollectionViewMode = "tree";

  constructor(
    root: HTMLElement,
    controller: TasksController,
    options: TasksRuntimeOptions = {},
  ) {
    this.root = root;
    this.controller = controller;
    this.options = options;
    this.release = controller.subscribe((change) => {
      if (change.reason === "selection") {
        const host = this.host();
        if (host) syncTasksSelection(host, change.state);
        return;
      }
      if (change.reason === "workspace") {
        this.treeDisclosures = initialDisclosures();
        this.treeExpansionTouched = initialTouched();
      }
      if (change.reason === "providers") this.reconcileExpandedTree(change.state);
      if (change.reason === "workspace" || change.reason === "providers" || change.reason === "query") this.visibleLimit = TASKS_RENDER_BATCH_SIZE;
      this.render(change.reason === "providers");
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

  render(preserveViewport = true): void {
    const host = this.host();
    if (!host) return;
    const focus = captureTasksFocus(host);
    const viewport = preserveViewport ? captureTasksViewport(host) : null;
    const copy = this.options.copy?.();
    host.innerHTML = renderTasksView(this.controller.state, copy, this.visibleLimit, this.disclosure().snapshot.exceptions, this.presentation, this.viewMode);
    syncTasksHeaderRefresh(this.root, this.controller.state, copy);
    this.bind();
    restoreTasksFocus(host, focus);
    restoreTasksViewport(host, viewport);
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
      const collectionCommand = target.closest<HTMLElement>("[data-collection-command]")?.dataset.collectionCommand;
      if (collectionCommand === "toggle-view") this.toggleViewMode();
      else if (collectionCommand === "expand-all") this.expandAll();
      else if (collectionCommand === "collapse-all") this.collapseAll();
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
        const collectionRow = target.closest<HTMLElement>("[data-collection-row]");
        if ((collectionRow || target.matches("[data-collection-root]")) && this.handleCollectionNavigation(host, collectionRow, keyboard)) return;
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
    if (this.viewMode !== "tree" || this.controller.state.query.trim()) return;
    this.treeExpansionTouched[this.presentation] = true;
    this.disclosure().toggle(key);
    this.visibleLimit = TASKS_RENDER_BATCH_SIZE;
    this.render();
  }

  private reconcileExpandedTree(state: TasksState): void {
    const copy = this.options.copy?.();
    for (const presentation of ["all-tasks-tree", "quick-actions-tree"] as const) {
      const entries = taskPresentationEntries(state, presentation, copy ?? renderCopyFallback);
      const tree = buildTaskTree(
        entries,
        state.identity?.root ?? "",
        presentation === "quick-actions-tree" ? copy?.androidQuickActions ?? "Android quick actions" : copy?.title ?? "Tasks",
        presentation === "all-tasks-tree" ? state.providers : [],
      );
      const available = taskTreeBranchKeys(tree);
      const current = this.treeDisclosures[presentation];
      const expanded = this.treeExpansionTouched[presentation]
        ? new Set([...available].filter((key) => current.isExpanded(key)))
        : presentation === "quick-actions-tree" ? available : taskTreeDefaultExpandedKeys(tree);
      expanded.add(TASK_TREE_ROOT_KEY);
      this.treeDisclosures[presentation] = expandedDisclosure(expanded);
    }
  }

  private handleCollectionNavigation(host: HTMLElement, row: HTMLElement | null, event: KeyboardEvent): boolean {
    const directional = ["ArrowDown", "ArrowUp", "Home", "End"];
    const treeOnly = ["ArrowRight", "ArrowLeft"];
    if (!directional.includes(event.key) && (this.viewMode !== "tree" || !treeOnly.includes(event.key))) return false;
    const decision = hierarchicalCollectionDomNavigation(host, row, event.key as HierarchicalCollectionNavigationKey);
    if (!decision.handled) return false;
    event.preventDefault();
    if (decision.toggleId) this.toggleTreeNode(decision.toggleId);
    else if (decision.focusId) {
      const target = hierarchicalCollectionRowElement(host, decision.focusId);
      if (target) this.focusTreeRow(target);
    }
    return true;
  }

  private toggleViewMode(): void {
    this.viewMode = this.viewMode === "tree" ? "flat" : "tree";
    this.visibleLimit = TASKS_RENDER_BATCH_SIZE;
    this.render();
  }

  private expandAll(): void {
    if (this.viewMode !== "tree" || this.controller.state.query.trim()) return;
    this.treeExpansionTouched[this.presentation] = true;
    this.disclosure().expandAll();
    this.visibleLimit = TASKS_RENDER_BATCH_SIZE;
    this.render();
  }

  private collapseAll(): void {
    if (this.viewMode !== "tree" || this.controller.state.query.trim()) return;
    this.treeExpansionTouched[this.presentation] = true;
    this.disclosure().collapseAll();
    this.visibleLimit = TASKS_RENDER_BATCH_SIZE;
    this.render();
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

  private disclosure(): DisclosureState { return this.treeDisclosures[this.presentation]; }

  private host(): HTMLElement | null { return this.root.querySelector<HTMLElement>("#tasks-tool-host"); }
}

function expandedDisclosure(keys: Iterable<string>): DisclosureState {
  return new DisclosureState({ defaultExpanded: false, exceptions: new Set(keys) });
}

function initialDisclosures(): Record<TaskPresentation, DisclosureState> {
  return {
    "all-tasks-tree": expandedDisclosure([TASK_TREE_ROOT_KEY]),
    "quick-actions-tree": new DisclosureState({ defaultExpanded: true }),
  };
}

function initialTouched(): Record<TaskPresentation, boolean> {
  return { "all-tasks-tree": false, "quick-actions-tree": false };
}

const renderCopyFallback = Object.freeze({
  quickActionKinds: { assemble: "Assemble", bundle: "Bundle", install: "Install", uninstall: "Uninstall" },
});

export function syncTasksHeaderRefresh(root: ParentNode, state: TasksState, copy?: TasksCopy): void {
  const headerRefresh = root.querySelector<HTMLButtonElement>("#tasks-header-refresh");
  if (!headerRefresh) return;
  headerRefresh.disabled = state.status === "loading";
  if (!copy) return;
  headerRefresh.setAttribute("aria-label", copy.refresh);
  headerRefresh.title = copy.refresh;
}

export interface TasksViewportSnapshot {
  readonly left: number;
  readonly top: number;
}

/** Preserve the user's place when provider/run-state updates replace the rendered task tree. */
export function captureTasksViewport(host: ParentNode): TasksViewportSnapshot | null {
  const list = host.querySelector<HTMLElement>(".tasks-list");
  return list ? { left: list.scrollLeft, top: list.scrollTop } : null;
}

export function restoreTasksViewport(host: ParentNode, snapshot: TasksViewportSnapshot | null): void {
  if (!snapshot) return;
  const list = host.querySelector<HTMLElement>(".tasks-list");
  if (!list) return;
  list.scrollLeft = snapshot.left;
  list.scrollTop = snapshot.top;
}

/** Selection is presentational state; update rows in place so a click never resets the scroll container. */
export function syncTasksSelection(host: ParentNode, state: Pick<TasksState, "visibleEntries" | "selectedIndex">): void {
  const selectedKey = state.visibleEntries[state.selectedIndex]?.key;
  host.querySelectorAll<HTMLElement>("[data-task-key]").forEach((row) => {
    row.setAttribute("aria-selected", String(row.dataset.taskKey === selectedKey));
  });
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
  const treeNode = active.closest<HTMLElement>("[data-collection-node-id]") ?? active.closest<HTMLElement>("[data-task-tree-key]");
  if (treeNode) return { kind: "tree-node", key: treeNode.dataset.collectionNodeId ?? treeNode.dataset.taskTreeKey ?? "" };
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
    const standardNodes = Array.from(host.querySelectorAll<HTMLElement>("[data-collection-node-id]"))
      .filter((candidate) => candidate.dataset.collectionNodeId !== undefined);
    const legacyNodes = Array.from(host.querySelectorAll<HTMLElement>("[data-task-tree-key]"));
    const nodes = [...standardNodes, ...legacyNodes.filter((candidate) => !standardNodes.includes(candidate))];
    const node = nodes.find((candidate) => (candidate.dataset.collectionNodeId ?? candidate.dataset.taskTreeKey) === snapshot.key);
    (node?.querySelector<HTMLElement>("[data-task-tree-toggle], [data-task-action=run]") ?? node)?.focus({ preventScroll: true });
    return;
  }
  const selected = host.querySelector<HTMLElement>('[role="treeitem"][aria-selected="true"]') ??
    host.querySelector<HTMLElement>("[role=tree]");
  selected?.focus({ preventScroll: true });
  if (selected && "scrollIntoView" in selected) selected.scrollIntoView({ block: "nearest" });
}
