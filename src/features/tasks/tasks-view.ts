import type { AndroidTaskQuickActionKind, TaskProviderUnavailableReason } from "../../application/tasks/task-types.ts";
import { icon } from "../../icons.ts";
import type { TasksState } from "./tasks-model.ts";
import {
  buildTaskTree,
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
  status: { idle: "Idle", queued: "Queued", running: "Running", succeeded: "Succeeded", failed: "Failed", cancelled: "Cancelled", crashed: "Crashed" },
});

export const TASKS_RENDER_BATCH_SIZE = 250;

export function renderTasksView(
  state: TasksState,
  copy: TasksCopy = DEFAULT_TASKS_COPY,
  visibleLimit = TASKS_RENDER_BATCH_SIZE,
  expandedTreeNodes?: ReadonlySet<string>,
): string {
  const status = renderStatus(state, copy);
  const query = `<label class="tasks-query-label"><span class="sr-only">${escapeHtml(copy.queryPlaceholder)}</span><input data-tasks-query type="search" value="${escapeAttribute(state.query)}" placeholder="${escapeAttribute(copy.queryPlaceholder)}" aria-label="${escapeAttribute(copy.queryPlaceholder)}" /></label>`;
  const quickActions = renderAndroidQuickActions(state, copy);
  const tree = buildTaskTree(state.visibleEntries, state.identity?.root ?? "", copy.title);
  const expanded = expandedTreeNodes ?? taskTreeDefaultExpandedKeys(tree);
  const forceExpanded = state.query.trim().length > 0;
  const projection = taskTreeRows(tree, expanded, visibleLimit, forceExpanded);
  const list = state.visibleEntries.length > 0
    ? `<div class="tasks-list tasks-tree" role="tree" aria-label="${escapeAttribute(copy.title)}" tabindex="0">${projection.rows.map((row) => renderTaskTreeRow(row, expanded, forceExpanded, state, copy)).join("")}</div>`
    : "";
  const more = projection.truncated
    ? `<footer class="tasks-list-more" role="status"><span>${escapeHtml(copy.showing(projection.renderedTasks, projection.visibleTasks))}</span><button type="button" data-tasks-action="show-more">${escapeHtml(copy.showMore)}</button></footer>`
    : "";
  return `<section class="tasks-tool${quickActions ? " tasks-tool-with-quick-actions" : ""}" data-tasks-status="${state.status}" role="region" aria-label="${escapeAttribute(copy.title)}" aria-busy="${state.status === "loading"}">${quickActions}${query}${status}${list}${more}</section>`;
}

function renderTaskTreeRow(
  row: TaskTreeRow,
  expandedTreeNodes: ReadonlySet<string>,
  forceExpanded: boolean,
  state: TasksState,
  copy: TasksCopy,
): string {
  if (row.node.type === "task") return taskRow(row as TaskTreeRow & { readonly node: TaskTreeTask }, state, copy);
  return taskBranchRow(row as TaskTreeRow & { readonly node: TaskTreeBranch }, expandedTreeNodes, forceExpanded, copy);
}

function taskBranchRow(
  row: TaskTreeRow & { readonly node: TaskTreeBranch },
  expandedTreeNodes: ReadonlySet<string>,
  forceExpanded: boolean,
  copy: TasksCopy,
): string {
  const { node } = row;
  const expanded = forceExpanded || expandedTreeNodes.has(node.key);
  const glyph = node.kind === "tasks" ? "list" : "folder";
  const detail = node.detail ? `<small>${escapeHtml(node.detail)}</small>` : "";
  const parent = node.parentKey ? ` data-task-tree-parent="${escapeAttribute(node.parentKey)}"` : "";
  return `<div class="tasks-tree-row tasks-tree-branch ${node.kind}" role="treeitem" tabindex="-1" data-task-tree-row data-task-tree-key="${escapeAttribute(node.key)}"${parent} style="--tree-depth:${row.depth}" aria-expanded="${expanded}" aria-selected="false" aria-level="${row.depth + 1}" aria-posinset="${row.positionInSet}" aria-setsize="${row.setSize}"><button type="button" data-task-tree-toggle="${escapeAttribute(node.key)}" aria-label="${escapeAttribute(expanded ? copy.collapse(node.label) : copy.expand(node.label))}" ${forceExpanded ? "disabled" : ""}><span class="tasks-tree-chevron ${expanded ? "expanded" : ""}">${icon("chevron", 11)}</span>${icon(glyph, 14)}<span class="tasks-tree-label"><strong>${escapeHtml(node.label)}</strong>${detail}</span></button></div>`;
}

function renderAndroidQuickActions(state: TasksState, copy: TasksCopy): string {
  const byKind = new Map<AndroidTaskQuickActionKind, { entry: TasksState["entries"][number]; action: NonNullable<TasksState["entries"][number]["task"]["androidQuickAction"]> }[]>();
  for (const entry of state.entries) {
    const action = entry.task.androidQuickAction;
    if (!action || !entry.task.runnable) continue;
    const entries = byKind.get(action.kind) ?? [];
    if (entries.length < 32) entries.push({ entry, action });
    byKind.set(action.kind, entries);
  }
  const actions = (["assemble", "bundle", "install", "uninstall"] as const)
    .flatMap((kind) => byKind.get(kind) ?? []);
  if (actions.length === 0) return "";
  return `<section class="tasks-quick-actions" aria-labelledby="tasks-quick-actions-title"><h3 id="tasks-quick-actions-title">${escapeHtml(copy.androidQuickActions)}</h3><div class="tasks-quick-action-list" role="list">${actions.map(({ entry, action }) => {
    const kind = copy.quickActionKinds[action.kind];
    const label = `${kind} ${action.variant}`;
    const accessible = `${label}, ${copy.quickActionModule}: ${action.module}, ${copy.quickActionVariant}: ${action.variant}`;
    const active = state.status === "loading" || entry.task.runState === "queued" || entry.task.runState === "running";
    return `<div class="tasks-quick-action" role="listitem" data-task-key="${escapeAttribute(entry.key)}"><button type="button" data-task-action="run" aria-label="${escapeAttribute(accessible)}" title="${escapeAttribute(entry.task.id)}" ${active ? "disabled" : ""}><strong>${escapeHtml(label)}</strong><small>${escapeHtml(copy.quickActionModule)}: ${escapeHtml(action.module)}</small><small>${escapeHtml(copy.quickActionVariant)}: ${escapeHtml(action.variant)}</small></button></div>`;
  }).join("")}</div></section>`;
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
  return `<div class="tasks-discovery-state tasks-discovery-error" data-tasks-discovery-state="error" role="alert"><span class="tasks-discovery-copy"><strong>${escapeHtml(copy.error)}</strong>${detail}</span><button type="button" data-tasks-action="refresh">${escapeHtml(copy.retryDiscovery)}</button></div>`;
}

function taskRow(
  row: TaskTreeRow & { readonly node: TaskTreeTask },
  state: TasksState,
  copy: TasksCopy,
): string {
  const { entry, label } = row.node;
  const { runnable, disabledReason, runState, description } = entry.task;
  const discoveryLoading = state.status === "loading";
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
  return `<div role="treeitem" tabindex="-1" class="tasks-row" data-task-tree-row data-task-tree-key="${escapeAttribute(row.node.key)}" data-task-tree-parent="${escapeAttribute(row.node.parentKey)}" data-task-key="${escapeAttribute(entry.key)}" style="--tree-depth:${row.depth}" aria-level="${row.depth + 1}" aria-posinset="${row.positionInSet}" aria-setsize="${row.setSize}" aria-selected="${selected}" aria-label="${escapeAttribute(label)}"><button type="button" class="tasks-row-primary" data-task-action="run" title="${escapeAttribute(tooltip)}" ${runnable && !active && !discoveryLoading ? "" : "disabled"}><span class="tasks-tree-leaf-spacer"></span>${icon("file", 13)}<span class="tasks-row-copy"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(entry.task.id)}</small>${status}</span></button>${actions}</div>`;
}

function message(text: string): string { return `<p class="tasks-message" role="status">${escapeHtml(text)}</p>`; }
function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character); }
function escapeAttribute(value: string): string { return escapeHtml(value).replaceAll("`", "&#96;"); }
