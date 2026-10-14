import type { TaskProviderUnavailableReason, TaskRunState } from "../../application/tasks/task-types.ts";
import type { TasksState } from "./tasks-model.ts";

export interface TasksCopy {
  readonly title: string;
  readonly refresh: string;
  readonly empty: string;
  readonly unavailable: string;
  readonly unavailableReasons: Readonly<Record<TaskProviderUnavailableReason, string>>;
  readonly loading: string;
  readonly error: string;
  readonly busy: string;
  readonly noResults: string;
  readonly queryPlaceholder: string;
  readonly run: string;
  readonly retry: string;
  readonly revealOutput: string;
  readonly notRunnable: string;
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
  error: "Task discovery failed.",
  busy: "Another task is already running for this workspace.",
  noResults: "No matching tasks.",
  queryPlaceholder: "Filter tasks",
  run: "Run task",
  retry: "Retry task",
  revealOutput: "Reveal output",
  notRunnable: "This task is not runnable.",
  status: { idle: "Idle", queued: "Queued", running: "Running", succeeded: "Succeeded", failed: "Failed", cancelled: "Cancelled", crashed: "Crashed" },
});

export function renderTasksView(state: TasksState, copy: TasksCopy = DEFAULT_TASKS_COPY): string {
  const status = renderStatus(state, copy);
  const query = `<label class="tasks-query-label"><span class="sr-only">${escapeHtml(copy.queryPlaceholder)}</span><input data-tasks-query type="search" value="${escapeAttribute(state.query)}" placeholder="${escapeAttribute(copy.queryPlaceholder)}" aria-label="${escapeAttribute(copy.queryPlaceholder)}" /></label>`;
  const groups = groupEntries(state.visibleEntries);
  const list = state.status === "ready" && state.visibleEntries.length > 0
    ? `<div class="tasks-list" role="listbox" aria-label="${escapeAttribute(copy.title)}" tabindex="0">${groups.map(([group, entries]) => `<section class="tasks-group" data-task-group="${escapeAttribute(group)}"><h3>${escapeHtml(group)}</h3>${entries.map((entry) => taskRow(entry.key, entry.providerLabel, entry.task.label, entry.task.description, entry.task.runnable, entry.task.disabledReason, entry.task.runState, entry.key === state.visibleEntries[state.selectedIndex]?.key, copy)).join("")}</section>`).join("")}</div>`
    : "";
  return `<section class="tasks-tool" role="region" aria-label="${escapeAttribute(copy.title)}"><header class="tasks-header"><h2>${escapeHtml(copy.title)}</h2><button type="button" data-tasks-action="refresh" aria-label="${escapeAttribute(copy.refresh)}" title="${escapeAttribute(copy.refresh)}">↻</button></header>${query}${status}${list}</section>`;
}

function renderStatus(state: TasksState, copy: TasksCopy): string {
  if (state.status === "empty") return message(copy.empty);
  if (state.status === "unavailable") {
    const reason = state.unavailableReason as TaskProviderUnavailableReason | null;
    return message(reason && reason in copy.unavailableReasons
      ? copy.unavailableReasons[reason]
      : copy.unavailable);
  }
  if (state.status === "loading") return message(copy.loading);
  if (state.status === "error") return message(state.error ? `${copy.error} ${state.error}` : copy.error);
  if (state.visibleEntries.length === 0) return message(copy.noResults);
  return "";
}

function taskRow(
  key: string,
  providerLabel: string,
  label: string,
  description: string | undefined,
  runnable: boolean,
  disabledReason: string | undefined,
  runState: TaskRunState | undefined,
  selected: boolean,
  copy: TasksCopy,
): string {
  const active = runState === "queued" || runState === "running";
  const terminal = runState === "succeeded" || runState === "failed" || runState === "cancelled" || runState === "crashed";
  const title = disabledReason ?? (runnable ? copy.run : copy.notRunnable);
  const status = runState && runState !== "idle"
    ? `<small class="tasks-run-status" role="status">${escapeHtml(copy.status[runState] ?? runState)}</small>`
    : "";
  const actions = terminal
    ? `<span class="tasks-row-actions"><button type="button" data-task-action="retry" title="${escapeAttribute(copy.retry)}">${escapeHtml(copy.retry)}</button><button type="button" data-task-action="reveal-output" title="${escapeAttribute(copy.revealOutput)}">${escapeHtml(copy.revealOutput)}</button></span>`
    : "";
  return `<div role="option" class="tasks-row" data-task-key="${escapeAttribute(key)}" aria-selected="${selected}" aria-label="${escapeAttribute(label)}"><button type="button" class="tasks-row-primary" data-task-action="run" title="${escapeAttribute(title)}" ${runnable && !active ? "" : "disabled"}><strong>${escapeHtml(label)}</strong><small class="tasks-provider">${escapeHtml(providerLabel)}</small>${description ? `<small>${escapeHtml(description)}</small>` : ""}${status}</button>${actions}</div>`;
}

function groupEntries(state: TasksState["visibleEntries"]): readonly [string, TasksState["visibleEntries"]][] {
  const groups = new Map<string, TasksState["visibleEntries"]>();
  for (const entry of state) groups.set(entry.task.group, [...(groups.get(entry.task.group) ?? []), entry]);
  return [...groups.entries()];
}

function message(text: string): string { return `<p class="tasks-message" role="status">${escapeHtml(text)}</p>`; }
function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character); }
function escapeAttribute(value: string): string { return escapeHtml(value).replaceAll("`", "&#96;"); }
