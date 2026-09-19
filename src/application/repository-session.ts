import type {
  GitOperationSnapshot,
  RepositorySnapshot,
  RepositoryStateSlice,
  TrackedChangeScan,
  UntrackedScan,
} from "../models.ts";
import { mergeTrackedChanges } from "./repository-changes.ts";
import {
  createSessionInvalidation,
  mergeSessionInvalidations,
  type SessionInvalidation,
  type SessionInvalidationCause,
  type SessionInvalidationSlice,
} from "./session-invalidation.ts";
import type { WorkspaceSessionIdentity } from "./workspace-session.ts";

export interface RepositorySessionState {
  readonly snapshot: RepositorySnapshot | null;
  readonly revision: number;
  readonly invalidation: SessionInvalidation | null;
}

export interface RepositoryReadLease {
  readonly identity: WorkspaceSessionIdentity;
  readonly baseRevision: number;
  readonly slices: readonly RepositoryStateSlice[];
}

export interface RepositoryReadCommit {
  readonly state: RepositorySessionState;
  readonly slices: readonly RepositoryStateSlice[];
  readonly capabilityChanged: boolean;
}

export const COMPLETE_REPOSITORY_STATE_SLICES = [
  "workingTree",
  "repositoryCapability",
  "head",
  "refs",
  "history",
  "operation",
] as const satisfies readonly RepositoryStateSlice[];

const REPOSITORY_STATE_SLICE_SET = new Set<RepositoryStateSlice>(
  COMPLETE_REPOSITORY_STATE_SLICES,
);

export class RepositorySession {
  private identity: WorkspaceSessionIdentity | null = null;
  private value: RepositorySessionState = {
    snapshot: null,
    revision: 0,
    invalidation: null,
  };

  get state(): RepositorySessionState {
    return this.value;
  }

  beginRead(
    identity: WorkspaceSessionIdentity,
    slices: Iterable<RepositoryStateSlice>,
  ): RepositoryReadLease | null {
    if (!sameIdentity(this.identity, identity)) return null;
    return {
      identity: { ...identity },
      baseRevision: this.value.revision,
      slices: repositorySlices(slices),
    };
  }

  installRead(
    lease: RepositoryReadLease,
    snapshot: RepositorySnapshot | null,
    cause: SessionInvalidationCause,
    options: { paths?: Iterable<string>; recovery?: import("../models.ts").WorkspaceWatchRecovery } = {},
  ): RepositoryReadCommit | null {
    if (
      !sameIdentity(this.identity, lease.identity) ||
      this.value.revision !== lease.baseRevision
    ) return null;
    const capabilityChanged = repositoryCapabilityChanged(this.value.snapshot, snapshot);
    const slices = capabilityChanged
      ? [...COMPLETE_REPOSITORY_STATE_SLICES]
      : repositorySlices(lease.slices);
    const state = this.install(lease.identity, snapshot, cause, slices, options);
    return { state, slices, capabilityChanged };
  }

  install(
    identity: WorkspaceSessionIdentity,
    snapshot: RepositorySnapshot | null,
    cause: SessionInvalidationCause,
    slices: Iterable<SessionInvalidationSlice>,
    options: { paths?: Iterable<string>; recovery?: import("../models.ts").WorkspaceWatchRecovery } = {},
  ): RepositorySessionState {
    if (snapshot && snapshot.root !== identity.root) {
      throw new Error("Repository snapshot belongs to another workspace session.");
    }
    const requestedSlices = Array.from(slices);
    const capabilityChanged = repositoryCapabilityChanged(this.value.snapshot, snapshot);
    const committedSlices = capabilityChanged
      ? mergeSlices(requestedSlices, COMPLETE_REPOSITORY_STATE_SLICES)
      : requestedSlices;
    const nextSnapshot = capabilityChanged
      ? snapshot
      : mergeRepositorySlices(this.value.snapshot, snapshot, committedSlices);
    const invalidation = createSessionInvalidation(
      identity.root,
      identity.generation,
      committedSlices,
      cause,
      options,
    );
    this.identity = { ...identity };
    this.value = {
      snapshot: nextSnapshot,
      revision: this.value.revision + 1,
      invalidation: mergeSessionInvalidations(this.value.invalidation, invalidation),
    };
    return this.value;
  }

  mergeTracked(
    identity: WorkspaceSessionIdentity,
    scan: TrackedChangeScan,
    cause: SessionInvalidationCause,
    paths: Iterable<string> = [],
    slices: Iterable<SessionInvalidationSlice> = ["workingTree"],
    expectedRevision?: number,
  ): RepositorySessionState | null {
    if (expectedRevision !== undefined && expectedRevision !== this.value.revision) return null;
    const snapshot = this.value.snapshot;
    if (!snapshot || snapshot.root !== identity.root || scan.root !== identity.root) return null;
    return this.install(
      identity,
      mergeTrackedChanges(snapshot, scan),
      cause,
      slices,
      { paths },
    );
  }

  mergeTrackedOperation(
    identity: WorkspaceSessionIdentity,
    scan: TrackedChangeScan,
    operation: GitOperationSnapshot | null,
    cause: SessionInvalidationCause,
    slices: Iterable<SessionInvalidationSlice>,
  ): RepositorySessionState | null {
    const snapshot = this.value.snapshot;
    if (!snapshot || snapshot.root !== identity.root || scan.root !== identity.root) return null;
    return this.install(
      identity,
      { ...mergeTrackedChanges(snapshot, scan), operation },
      cause,
      slices,
    );
  }

  mergeUntracked(
    identity: WorkspaceSessionIdentity,
    scan: UntrackedScan,
    cause: SessionInvalidationCause,
    expectedRevision?: number,
  ): RepositorySessionState | null {
    if (expectedRevision !== undefined && expectedRevision !== this.value.revision) return null;
    const snapshot = this.value.snapshot;
    if (!snapshot || snapshot.root !== identity.root || scan.root !== identity.root) return null;
    const tracked = snapshot.changes.filter(
      (change) => change.worktreeStatus !== "untracked",
    );
    const next: RepositorySnapshot = {
      ...snapshot,
      changes: [...tracked, ...scan.changes].sort((left, right) =>
        left.path.localeCompare(right.path),
      ),
      untrackedState: "complete",
    };
    return this.install(identity, next, cause, ["workingTree", "workspaceCatalog"]);
  }

  markUntrackedFailed(identity: WorkspaceSessionIdentity): boolean {
    const snapshot = this.value.snapshot;
    if (!snapshot || snapshot.root !== identity.root) return false;
    return Boolean(this.install(
      identity,
      { ...snapshot, untrackedState: "failed" },
      "overflowRecovery",
      ["workingTree"],
    ));
  }

  consumeInvalidation(): SessionInvalidation | null {
    const invalidation = this.value.invalidation;
    this.value = { ...this.value, invalidation: null };
    return invalidation;
  }

  clear(): void {
    this.identity = null;
    this.value = {
      snapshot: null,
      revision: this.value.revision + 1,
      invalidation: null,
    };
  }
}

function mergeRepositorySlices(
  current: RepositorySnapshot | null,
  incoming: RepositorySnapshot | null,
  slices: Iterable<RepositoryStateSlice>,
): RepositorySnapshot | null {
  if (!current || !incoming) return incoming;
  const selected = new Set(slices);
  return {
    ...current,
    ...(selected.has("workingTree")
      ? { changes: incoming.changes, untrackedState: incoming.untrackedState }
      : {}),
    ...(selected.has("head") ? { branch: incoming.branch } : {}),
    ...(selected.has("refs")
      ? {
          branches: incoming.branches,
          remotes: incoming.remotes,
          repositoryRoots: incoming.repositoryRoots,
        }
      : {}),
    ...(selected.has("history") ? { commits: incoming.commits } : {}),
    ...(selected.has("operation") ? { operation: incoming.operation } : {}),
  };
}

function repositoryCapabilityChanged(
  current: RepositorySnapshot | null,
  incoming: RepositorySnapshot | null,
): boolean {
  return Boolean(current) !== Boolean(incoming) ||
    Boolean(current && incoming && current.gitDir !== incoming.gitDir);
}

function repositorySlices(slices: Iterable<RepositoryStateSlice>): RepositoryStateSlice[] {
  return Array.from(new Set(slices)).filter((slice) => REPOSITORY_STATE_SLICE_SET.has(slice));
}

function mergeSlices(
  first: Iterable<RepositoryStateSlice>,
  second: Iterable<RepositoryStateSlice>,
): RepositoryStateSlice[] {
  return Array.from(new Set([...first, ...second]));
}

function sameIdentity(
  current: WorkspaceSessionIdentity | null,
  candidate: WorkspaceSessionIdentity,
): boolean {
  return current?.root === candidate.root && current.generation === candidate.generation;
}
