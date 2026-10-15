import type { AndroidTaskQuickActionKind, TaskProviderStaleReason, TaskProviderUnavailableReason } from "../../application/tasks/task-types.ts";
import type { TaskProviderCacheMetadata } from "../../application/tasks/task-types.ts";
import { icon } from "../../icons.ts";
import type { CollectionViewMode } from "../../presentation/hierarchical-collection.ts";
import { renderHierarchicalCollectionToolbar } from "../../presentation/hierarchical-collection-toolbar.ts";
import {
  renderHierarchicalCollection,
  type HierarchicalCollectionRenderedRow,
} from "../../presentation/hierarchical-collection-view.ts";
import type { TaskPresentation, TasksState } from "./tasks-model.ts";
import {
  buildTaskTree,
  taskTreeBranchKeys,
  taskTreeDefaultExpandedKeys,
  taskTreeRows,
  type TaskTreeBranch,
  type TaskTreeRow,
  type TaskTreeTask,
} from "./tasks-tree.ts";

export interface TasksCopy {
  readonly title: string;
  readonly refresh: string;
  readonly empty: string;
  readonly unavailable: string;
  readonly unavailableReasons: Readonly<Record<TaskProviderUnavailableReason, string>>;
  readonly loading: string;
  readonly cancelDiscovery: string;
  readonly error: string;
  readonly retryDiscovery: string;
  readonly discovered: (count: number) => string;
  readonly providerLoading: (provider: string) => string;
  readonly showing: (count: number, total: number) => string;
  readonly showMore: string;
  readonly expand: (label: string) => string;
  readonly collapse: (label: string) => string;
  readonly collectionControls: string;
  readonly showAsTree: string;
  readonly showAsFlat: string;
  readonly expandAll: string;
  readonly collapseAll: string;
  readonly busy: string;
  readonly noResults: string;
  readonly queryPlaceholder: string;
  readonly run: string;
  readonly retry: string;
  readonly revealOutput: string;
  readonly notRunnable: string;
  readonly androidQuickActions: string;
  readonly quickActionKinds: Readonly<Record<AndroidTaskQuickActionKind, string>>;
  readonly quickActionModule: string;
  readonly quickActionVariant: string;
  readonly cacheValidating: string;
  readonly cacheRestored: (count: number) => string;
  readonly cacheStale: string;
  readonly cacheStaleReasons: Readonly<Record<TaskProviderStaleReason, string>>;
  readonly refreshStale: string;
  readonly retainedTasks: (count: number) => string;
  readonly status: Readonly<Record<string, string>>;
}

export const DEFAULT_TASKS_COPY: TasksCopy = Object.freeze({
  title: "Tasks",
  refresh: "Refresh tasks",
  empty: "No task providers are active.",
  unavailable: "Task discovery is unavailable for this project.",
  unavailableReasons: {
    "discovery-not-supported": "This project does not support task discovery.",
    "evidence-incomplete": "Project evidence is incomplete for task discovery.",
    "workspace-untrusted": "Trust this workspace before discovering tasks.",
  },
  loading: "Loading tasks…",
  cancelDiscovery: "Cancel discovery",
  error: "Task discovery failed.",
  retryDiscovery: "Retry discovery",
  discovered: (count: number) => `${count} task${count === 1 ? "" : "s"} discovered`,
  providerLoading: (provider: string) => `Discovering tasks from ${provider}…`,
  showing: (count: number, total: number) => `Showing ${count} of ${total} expanded tasks`,
  showMore: "Load more tasks",
  expand: (label: string) => `Expand ${label}`,
  collapse: (label: string) => `Collapse ${label}`,
  collectionControls: "Task list controls",
  showAsTree: "Show tasks as a tree",
  showAsFlat: "Show tasks as a flat list",
  expandAll: "Expand all task groups",
  collapseAll: "Collapse all task groups",
  busy: "Another task is already running for this workspace.",
  noResults: "No matching tasks.",
  queryPlaceholder: "Filter tasks",
  run: "Run task",
  retry: "Retry task",
  revealOutput: "Reveal output",
  notRunnable: "This task is not runnable.",
  androidQuickActions: "Android quick actions",
  quickActionKinds: { assemble: "Assemble", bundle: "Bundle", install: "Install", uninstall: "Uninstall" },
  quickActionModule: "Module",
  quickActionVariant: "Variant",
  cacheValidating: "Verifying project configuration…",
  cacheRestored: (count: number) => `${count} task${count === 1 ? "" : "s"} restored from cache`,
  cacheStale: "Showing the last discovered task list; refresh to verify it.",
  cacheStaleReasons: {
    "fingerprint-mismatch": "Project configuration changed.", "watcher-change": "A watched project file changed.",
    "overflow-recovery": "File watching recovered incompletely.", "cache-miss": "No cached task list is available yet.", "cache-expired": "The cached task list has expired.",
    "cache-corrupt": "The cached task list is invalid.", "fingerprint-unavailable": "Project configuration could not be verified.",
    "refresh-failed": "The latest task refresh did not complete.",
  },
  refreshStale: "Refresh Gradle tasks",
  retainedTasks: (count: number) => `Showing the previous ${count} task${count === 1 ? "" : "s"}.`,
  status: { idle: "Idle", queued: "Queued", running: "Running", succeeded: "Succeeded", failed: "Failed", cancelled: "Cancelled", crashed: "Crashed" },
});

export const TASKS_RENDER_BATCH_SIZE = 250;

export function renderTasksView(
  state: TasksState,
  copy: TasksCopy = DEFAULT_TASKS_COPY,
  visibleLimit = TASKS_RENDER_BATCH_SIZE,
  expandedTreeNodes?: ReadonlySet<string>,
  presentation: TaskPresentation = "all-tasks-tree",
  viewMode: CollectionViewMode = "tree",
): string {
  const entries = taskPresentationEntries(state, presentation, copy);
  const projectedState = entries === state.visibleEntries ? state : { ...state, entries, visibleEntries: entries };
  const status = renderStatus(projectedState, copy);
  const query = `<label class="tasks-query-label"><input data-tasks-query type="search" value="${escapeAttribute(state.query)}" placeholder="${escapeAttribute(copy.queryPlaceholder)}" aria-label="${escapeAttribute(copy.queryPlaceholder)}" /></label>`;
  const collectionToolbar = renderHierarchicalCollectionToolbar({
    mode: viewMode,
    ariaLabel: copy.collectionControls,
    className: "tasks-collection-toolbar",
    commands: [
      { id: "toggle-view", label: viewMode === "tree" ? copy.showAsFlat : copy.showAsTree, icon: "eye", pressed: viewMode === "tree", disabled: entries.length === 0 },
      { id: "expand-all", label: copy.expandAll, icon: "expand", disabled: viewMode === "flat" || entries.length === 0 || state.query.trim().length > 0 },
      { id: "collapse-all", label: copy.collapseAll, icon: "collapse", disabled: viewMode === "flat" || entries.length === 0 || state.query.trim().length > 0 },
    ],
  });
  const queryRow = `<div class="tasks-query-row">${query}${collectionToolbar}</div>`;
  const tree = buildTaskTree(entries, state.identity?.root ?? "", presentation === "quick-actions-tree" ? copy.androidQuickActions : copy.title, presentation === "all-tasks-tree" ? state.providers : []);
  const expanded = expandedTreeNodes ?? (presentation === "quick-actions-tree" ? taskTreeBranchKeys(tree) : taskTreeDefaultExpandedKeys(tree));
  const forceExpanded = viewMode === "tree" && state.query.trim().length > 0;
  const projection = taskTreeRows(tree, expanded, visibleLimit, forceExpanded, viewMode);
  const list = entries.length > 0
    ? renderHierarchicalCollection({
      projection,
      mode: viewMode,
      ariaLabel: copy.title,
      className: "tasks-list tasks-tree",
      renderRow: (row) => renderTaskTreeRow(row, forceExpanded, state, copy),
    })
    : "";
  const more = projection.truncated
    ? `<footer class="tasks-list-more" role="status"><span>${escapeHtml(copy.showing(projection.renderedTasks, projection.visibleTasks))}</span><button type="button" data-tasks-action="show-more">${escapeHtml(copy.showMore)}</button></footer>`
    : "";
  return `<section class="tasks-tool" data-tasks-presentation="${presentation}" data-tasks-status="${state.status}" role="region" aria-label="${escapeAttribute(copy.title)}" aria-busy="${state.status === "loading"}">${queryRow}${status}${list}${more}</section>`;
}

export function taskPresentationEntries(
  state: TasksState,
  presentation: TaskPresentation,
  copy: Pick<TasksCopy, "quickActionKinds">,
): readonly TasksState["visibleEntries"][number][] {
  if (presentation === "all-tasks-tree") return state.visibleEntries;
  return state.visibleEntries.filter((entry) => entry.task.runnable && entry.task.androidQuickAction).map((entry) => {
    const action = entry.task.androidQuickAction;
    return action ? {
      ...entry,
      displayLabel: entry.task.id,
      task: { ...entry.task, group: copy.quickActionKinds[action.kind] },
    } : entry;
  });
}

function renderTaskTreeRow(
  row: TaskTreeRow,
  forceExpanded: boolean,
  state: TasksState,
  copy: TasksCopy,
): HierarchicalCollectionRenderedRow {
  if (row.node.type === "task") return taskRow(row as TaskTreeRow & { readonly node: TaskTreeTask }, state, copy);
  return taskBranchRow(row as TaskTreeRow & { readonly node: TaskTreeBranch }, forceExpanded, copy);
}

function taskBranchRow(
  row: TaskTreeRow & { readonly node: TaskTreeBranch },
  forceExpanded: boolean,
  copy: TasksCopy,
): HierarchicalCollectionRenderedRow {
  const { node } = row;
  const expanded = row.expanded;
  const glyph = node.kind === "tasks" ? "list" : "folder";
  const detail = node.detail ? `<small>${escapeHtml(node.detail)}</small>` : "";
  return {
    className: `tasks-tree-row tasks-tree-branch ${node.kind}`,
    selected: false,
    attributes: {
      "data-task-tree-row": true,
      "data-task-tree-key": node.key,
      "data-task-tree-parent": node.parentKey,
    },
    content: `<button type="button" data-task-tree-toggle="${escapeAttribute(node.key)}" aria-label="${escapeAttribute(expanded ? copy.collapse(node.label) : copy.expand(node.label))}" ${forceExpanded ? "disabled" : ""}><span class="tasks-tree-chevron ${expanded ? "expanded" : ""}">${icon("chevron", 11)}</span>${icon(glyph, 14)}<span class="tasks-tree-label"><strong>${escapeHtml(node.label)}</strong>${detail}</span></button>`,
  };
}

function renderStatus(state: TasksState, copy: TasksCopy): string {
  if (state.status === "empty") return message(copy.empty);
  if (state.status === "unavailable") {
    const reason = state.unavailableReason as TaskProviderUnavailableReason | null;
    return message(reason && reason in copy.unavailableReasons
      ? copy.unavailableReasons[reason]
      : copy.unavailable);
  }
  if (state.status === "loading") return renderLoading(state, copy);
  if (state.status === "error") return renderError(state, copy);
  const cache = cacheMetadata(state);
  if (cache?.status === "validating") {
    return `<div class="tasks-cache-state" data-tasks-cache-state="validating" role="status" aria-live="polite"><strong>${escapeHtml(copy.cacheValidating)}</strong></div>`;
  }
  if (cache?.status === "stale") {
    const reason = cache.staleReason ? (copy.cacheStaleReasons[cache.staleReason] ?? copy.cacheStale) : copy.cacheStale;
    return `<div class="tasks-cache-state" data-tasks-cache-state="stale" role="status"><strong>${escapeHtml(copy.cacheStale)}</strong><small>${escapeHtml(reason)}</small><button type="button" data-tasks-action="refresh">${escapeHtml(copy.refreshStale)}</button></div>`;
  }
  if (cache?.status === "ready" && cache.restoredTaskCount !== undefined) {
    return `<p class="tasks-discovery-count" data-tasks-cache-state="ready" role="status">${escapeHtml(copy.cacheRestored(cache.restoredTaskCount))}</p>${state.visibleEntries.length === 0 ? message(copy.noResults) : ""}`;
  }
  if (state.status === "ready") return `<p class="tasks-discovery-count" role="status">${escapeHtml(copy.discovered(state.entries.length))}</p>${state.visibleEntries.length === 0 ? message(copy.noResults) : ""}`;
  if (state.visibleEntries.length === 0) return message(copy.noResults);
  return "";
}

function renderLoading(state: TasksState, copy: TasksCopy): string {
  const providers = state.providers
    .filter((provider) => provider.snapshot.status === "loading")
    .map((provider) => provider.label);
  const detail = providers.length > 0
    ? providers.map((provider) => `<small>${escapeHtml(copy.providerLoading(provider))}</small>`).join("")
    : `<small>${escapeHtml(copy.loading)}</small>`;
  return `<div class="tasks-discovery-state tasks-discovery-loading" data-tasks-discovery-state="loading" role="status" aria-live="polite"><span class="tasks-spinner" aria-hidden="true"></span><span class="tasks-discovery-copy"><strong>${escapeHtml(copy.loading)}</strong>${detail}</span><button type="button" data-tasks-action="cancel">${escapeHtml(copy.cancelDiscovery)}</button></div>`;
}

function renderError(state: TasksState, copy: TasksCopy): string {
  const detail = state.error ? `<small>${escapeHtml(state.error)}</small>` : "";
  const retained = state.entries.length > 0 ? `<small>${escapeHtml(copy.retainedTasks(state.entries.length))}</small>` : "";
  return `<div class="tasks-discovery-state tasks-discovery-error" data-tasks-discovery-state="error" role="alert"><span class="tasks-discovery-copy"><strong>${escapeHtml(copy.error)}</strong>${detail}${retained}</span><button type="button" data-tasks-action="refresh">${escapeHtml(copy.retryDiscovery)}</button></div>`;
}

function cacheMetadata(state: TasksState): TaskProviderCacheMetadata | null {
  const metadata = state.providers.map((provider) => provider.snapshot.cache).filter(Boolean) as TaskProviderCacheMetadata[];
  if (metadata.some((value) => value.status === "validating")) return { status: "validating" };
  const stale = metadata.find((value) => value.status === "stale");
  if (stale) return stale;
  return metadata.find((value) => value.status === "ready") ?? null;
}

function taskRow(
  row: TaskTreeRow & { readonly node: TaskTreeTask },
  state: TasksState,
  copy: TasksCopy,
): HierarchicalCollectionRenderedRow {
  const { entry, label } = row.node;
  const { runnable, disabledReason, runState, description } = entry.task;
  const discoveryLoading = state.status === "loading";
  const cacheState = cacheMetadata(state);
  const cacheLocked = cacheState !== null && cacheState.status !== "ready";
  const selected = entry.key === state.visibleEntries[state.selectedIndex]?.key;
  const active = runState === "queued" || runState === "running";
  const terminal = runState === "succeeded" || runState === "failed" || runState === "cancelled" || runState === "crashed";
  const title = disabledReason ?? (runnable ? copy.run : copy.notRunnable);
  const status = runState && runState !== "idle"
    ? `<small class="tasks-run-status" role="status">${escapeHtml(copy.status[runState] ?? runState)}</small>`
    : "";
  const actions = terminal
    ? `<span class="tasks-row-actions"><button type="button" data-task-action="retry" title="${escapeAttribute(copy.retry)}" ${discoveryLoading ? "disabled" : ""}>${escapeHtml(copy.retry)}</button><button type="button" data-task-action="reveal-output" title="${escapeAttribute(copy.revealOutput)}">${escapeHtml(copy.revealOutput)}</button></span>`
    : "";
  const tooltip = [entry.task.id, description, title].filter(Boolean).join(" · ");
  return {
    className: "tasks-row",
    selected,
    attributes: {
      "data-task-tree-row": true,
      "data-task-tree-key": row.node.key,
      "data-task-tree-parent": row.node.parentKey,
      "data-task-key": entry.key,
      "aria-label": label,
    },
    content: `<button type="button" class="tasks-row-primary" data-task-action="run" title="${escapeAttribute(tooltip)}" ${runnable && !cacheLocked && !active && !discoveryLoading ? "" : "disabled"}><span class="tasks-tree-leaf-spacer"></span>${icon("file", 13)}<span class="tasks-row-copy"><strong>${escapeHtml(label)}</strong>${status}</span></button>${actions}`,
  };
}

function message(text: string): string { return `<p class="tasks-message" role="status">${escapeHtml(text)}</p>`; }
function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character); }
function escapeAttribute(value: string): string { return escapeHtml(value).replaceAll("`", "&#96;"); }
