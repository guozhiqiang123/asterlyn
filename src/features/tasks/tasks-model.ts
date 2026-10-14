import type { TaskDescriptor, TaskProviderSnapshot } from "../../application/tasks/task-types.ts";

export interface TasksWorkspaceIdentity {
  readonly root: string;
  readonly generation: number;
}

export interface TaskProviderProjection {
  readonly id: string;
  readonly label: string;
  readonly snapshot: TaskProviderSnapshot;
}

export type TasksStatus = "empty" | "unavailable" | "loading" | "error" | "ready";

export interface TasksEntry {
  readonly key: string;
  readonly providerId: string;
  readonly providerLabel: string;
  readonly task: TaskDescriptor;
}

export interface TasksState {
  readonly identity: TasksWorkspaceIdentity | null;
  readonly status: TasksStatus;
  readonly providers: readonly TaskProviderProjection[];
  readonly entries: readonly TasksEntry[];
  readonly visibleEntries: readonly TasksEntry[];
  readonly query: string;
  readonly selectedIndex: number;
  readonly error: string | null;
  readonly unavailableReason: string | null;
}

export function taskEntryKey(providerId: string, taskId: string): string {
  return `${providerId}:${taskId}`;
}

export function workspaceIdentityEqual(
  left: TasksWorkspaceIdentity | null,
  right: TasksWorkspaceIdentity | null,
): boolean {
  return left !== null && right !== null && left.root === right.root && left.generation === right.generation;
}
