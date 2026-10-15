import type {
  TaskDescriptor,
  AndroidTaskQuickActionKind,
  TaskProviderUnavailableReason,
  TaskProviderCacheMetadata,
  TaskProviderCacheStatus,
  TaskProviderStaleReason,
  TaskRunState,
} from "../../application/tasks/task-types.ts";
import {
  taskEntryKey,
  workspaceIdentityEqual,
  type TaskProviderProjection,
  type TasksEntry,
  type TasksState,
  type TasksStatus,
  type TasksWorkspaceIdentity,
} from "./tasks-model.ts";

export type TasksChangeReason = "workspace" | "providers" | "query" | "selection";
export interface TasksChange {
  readonly reason: TasksChangeReason;
  readonly state: TasksState;
}
type Listener = (change: TasksChange) => void;

export class TasksController {
  private value: TasksState = emptyState();
  private readonly listeners = new Set<Listener>();
  private disposed = false;

  get state(): TasksState { return this.value; }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  activate(identity: TasksWorkspaceIdentity): boolean {
    if (workspaceIdentityEqual(this.value.identity, identity)) return false;
    this.value = emptyState(identity);
    this.emit("workspace");
    return true;
  }

  clear(): void {
    if (this.value.identity === null && this.value.status === "empty") return;
    this.value = emptyState();
    this.emit("workspace");
  }

  acceptProviders(
    identity: TasksWorkspaceIdentity,
    providers: readonly TaskProviderProjection[],
  ): boolean {
    if (!workspaceIdentityEqual(this.value.identity, identity)) return false;
    const previousKey = this.selectedTask()?.key ?? null;
    const normalized = normalizeProviders(providers);
    const entries = normalized.flatMap((provider) => provider.snapshot.tasks.map((task) => ({
        key: taskEntryKey(provider.id, task.id),
        providerId: provider.id,
        providerLabel: provider.label,
        task: { ...task },
      })));
    const visibleEntries = filterEntries(entries, this.value.query);
    const selectedIndex = preserveSelection(visibleEntries, previousKey, this.value.selectedIndex);
    this.value = {
      ...this.value,
      providers: normalized,
      entries,
      visibleEntries,
      status: aggregateStatus(normalized),
      selectedIndex,
      error: firstProviderError(normalized),
      unavailableReason: firstUnavailableReason(normalized),
    };
    this.emit("providers");
    return true;
  }

  setQuery(query: string): void {
    const normalized = query.slice(0, 256);
    if (normalized === this.value.query) return;
    const previousKey = this.selectedTask()?.key ?? null;
    const visibleEntries = filterEntries(this.value.entries, normalized);
    this.value = {
      ...this.value,
      query: normalized,
      visibleEntries,
      selectedIndex: preserveSelection(visibleEntries, previousKey, 0),
    };
    this.emit("query");
  }

  moveSelection(offset: -1 | 1): boolean {
    const length = this.value.visibleEntries.length;
    if (length === 0) return false;
    const next = Math.max(0, Math.min(length - 1, this.value.selectedIndex + offset));
    if (next === this.value.selectedIndex) return false;
    this.value = { ...this.value, selectedIndex: next };
    this.emit("selection");
    return true;
  }

  select(index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= this.value.visibleEntries.length) return false;
    if (index === this.value.selectedIndex) return true;
    this.value = { ...this.value, selectedIndex: index };
    this.emit("selection");
    return true;
  }

  selectKey(key: string): boolean {
    const index = this.value.visibleEntries.findIndex((entry) => entry.key === key);
    return index >= 0 && this.select(index);
  }

  selectedTask(): TasksEntry | null {
    return this.value.visibleEntries[this.value.selectedIndex] ?? null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
  }

  private emit(reason: TasksChangeReason): void {
    if (this.disposed) return;
    const change = { reason, state: this.value };
    for (const listener of this.listeners) listener(change);
  }
}

function emptyState(identity: TasksWorkspaceIdentity | null = null): TasksState {
  return {
    identity,
    status: "empty",
    providers: [],
    entries: [],
    visibleEntries: [],
    query: "",
    selectedIndex: 0,
    error: null,
    unavailableReason: null,
  };
}

const MAX_PROVIDER_FIELD_LENGTH = 256;
const MAX_TASKS_PER_PROVIDER = 32_768;

function normalizeProviders(providers: readonly TaskProviderProjection[]): TaskProviderProjection[] {
  const seen = new Set<string>();
  const result: TaskProviderProjection[] = [];
  for (const candidate of providers) {
    const provider = normalizeProvider(candidate);
    if (!provider || seen.has(provider.id)) continue;
    seen.add(provider.id);
    result.push(provider);
  }
  return result;
}

function normalizeProvider(candidate: TaskProviderProjection): TaskProviderProjection | null {
  if (!candidate || typeof candidate !== "object") return null;
  const id = boundedString(candidate.id);
  if (!id) return null;
  const label = boundedString(candidate.label) ?? id;
  const source = candidate.snapshot;
  if (!source || typeof source !== "object") return invalidProvider(id, label);
  const status = source.status;
  if (status !== "unavailable" && status !== "loading" && status !== "ready" && status !== "error") {
    return invalidProvider(id, label);
  }
  if (!Array.isArray(source.tasks)) return invalidProvider(id, label);
  const tasks = source.tasks;
  const seenTaskIds = new Set<string>();
  const normalizedTasks: TaskDescriptor[] = [];
  for (const task of tasks.slice(0, MAX_TASKS_PER_PROVIDER)) {
    const normalized = normalizeTask(task);
    if (!normalized || seenTaskIds.has(normalized.id)) continue;
    seenTaskIds.add(normalized.id);
    normalizedTasks.push(normalized);
  }
  const unavailableReason = isUnavailableReason(source.unavailableReason) ? source.unavailableReason : undefined;
  const error = boundedString(source.error);
  const cache = normalizeCacheMetadata(source.cache);
  const safeTasks = cache && cache.status !== "ready"
    ? normalizedTasks.map((task) => ({ ...task, runnable: false }))
    : normalizedTasks;
  return {
    id,
    label,
    snapshot: { status, tasks: safeTasks, unavailableReason, error, ...(cache ? { cache } : {}) },
  };
}

const CACHE_STATUSES = new Set<TaskProviderCacheStatus>(["validating", "ready", "stale"]);
const STALE_REASONS = new Set<TaskProviderStaleReason>([
  "fingerprint-mismatch", "watcher-change", "overflow-recovery", "cache-miss", "cache-expired", "cache-corrupt", "refresh-failed", "fingerprint-unavailable",
]);

function normalizeCacheMetadata(value: unknown): TaskProviderCacheMetadata | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as { readonly status?: unknown; readonly staleReason?: unknown; readonly restoredTaskCount?: unknown };
  if (!CACHE_STATUSES.has(source.status as TaskProviderCacheStatus)) return undefined;
  const status = source.status as TaskProviderCacheStatus;
  if (source.staleReason !== undefined &&
    (status !== "stale" || !STALE_REASONS.has(source.staleReason as TaskProviderStaleReason))) return undefined;
  if (source.restoredTaskCount !== undefined &&
    (!Number.isSafeInteger(source.restoredTaskCount) || (source.restoredTaskCount as number) < 0 ||
      (source.restoredTaskCount as number) > MAX_TASKS_PER_PROVIDER)) return undefined;
  return {
    status,
    ...(status === "stale" && source.staleReason !== undefined ? { staleReason: source.staleReason as TaskProviderStaleReason } : {}),
    ...(source.restoredTaskCount !== undefined ? { restoredTaskCount: source.restoredTaskCount as number } : {}),
  };
}

function invalidProvider(id: string, label: string): TaskProviderProjection {
  return { id, label, snapshot: { status: "error", tasks: [], error: "Invalid task provider projection" } };
}

function normalizeTask(candidate: TaskDescriptor): TaskDescriptor | null {
  if (!candidate || typeof candidate !== "object") return null;
  const id = boundedString(candidate.id);
  const label = boundedString(candidate.label);
  const group = boundedString(candidate.group);
  if (!id || !label || !group || typeof candidate.runnable !== "boolean") return null;
  const projectPath = boundedProjectPath(candidate.projectPath);
  return {
    id,
    label,
    group,
    ...(projectPath ? { projectPath } : {}),
    runnable: candidate.runnable,
    description: boundedString(candidate.description),
    disabledReason: boundedString(candidate.disabledReason),
    runState: isTaskRunState(candidate.runState) ? candidate.runState : undefined,
    androidQuickAction: normalizeAndroidQuickAction(candidate.androidQuickAction, id),
  };
}

function boundedProjectPath(value: unknown): string | undefined {
  const path = boundedString(value);
  return path && /^:(?:[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)*)?$/u.test(path) ? path : undefined;
}

function normalizeAndroidQuickAction(value: TaskDescriptor["androidQuickAction"], taskId: string): TaskDescriptor["androidQuickAction"] {
  if (!value || typeof value !== "object") return undefined;
  const kind = value.kind;
  const module = boundedString(value.module);
  const variant = boundedString(value.variant);
  if (!isAndroidQuickActionKind(kind) || !module || !variant ||
    !/^:(?:[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)*)?$/u.test(module) ||
    !/^[A-Z][A-Za-z0-9_.-]*$/u.test(variant)) return undefined;
  const expectedTaskId = module === ":" ? `:${kind}${variant}` : `${module}:${kind}${variant}`;
  if (taskId !== expectedTaskId) return undefined;
  return { kind, module, variant };
}

function boundedString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, MAX_PROVIDER_FIELD_LENGTH)
    : undefined;
}

function isUnavailableReason(value: unknown): value is TaskProviderUnavailableReason {
  return value === "discovery-not-supported" || value === "evidence-incomplete" || value === "workspace-untrusted";
}

function isTaskRunState(value: unknown): value is TaskRunState {
  return value === "idle" || value === "queued" || value === "running" ||
    value === "succeeded" || value === "failed" || value === "cancelled" || value === "crashed";
}

function isAndroidQuickActionKind(value: unknown): value is AndroidTaskQuickActionKind {
  return value === "assemble" || value === "bundle" || value === "install" || value === "uninstall";
}

function aggregateStatus(providers: readonly TaskProviderProjection[]): TasksStatus {
  if (providers.length === 0) return "empty";
  if (providers.some((provider) => provider.snapshot.status === "ready" && provider.snapshot.tasks.length > 0)) return "ready";
  if (providers.some((provider) => provider.snapshot.status === "loading")) return "loading";
  if (providers.some((provider) => provider.snapshot.status === "error")) return "error";
  if (providers.some((provider) => provider.snapshot.status === "ready")) return "ready";
  return "unavailable";
}

function firstProviderError(providers: readonly TaskProviderProjection[]): string | null {
  return providers.find((provider) => provider.snapshot.error)?.snapshot.error ?? null;
}

function firstUnavailableReason(providers: readonly TaskProviderProjection[]): string | null {
  return providers.find((provider) => provider.snapshot.unavailableReason)?.snapshot.unavailableReason ?? null;
}

function filterEntries(entries: readonly TasksEntry[], query: string): TasksEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...entries];
  return entries.filter((entry) => [entry.task.id, entry.task.label, entry.task.group, entry.task.projectPath ?? "", entry.task.description ?? "", entry.providerLabel]
    .some((value) => value.toLocaleLowerCase().includes(needle)));
}

function preserveSelection(entries: readonly TasksEntry[], key: string | null, fallback: number): number {
  if (entries.length === 0) return 0;
  const byKey = key === null ? -1 : entries.findIndex((entry) => entry.key === key);
  return byKey >= 0 ? byKey : Math.max(0, Math.min(entries.length - 1, fallback));
}
