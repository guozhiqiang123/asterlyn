import type {
  RepositorySnapshot,
  TrackedChangeScan,
  UntrackedScan,
} from "../models.ts";
import { mergeTrackedChanges } from "../workbench/repository-changes.ts";
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

export class RepositorySession {
  private value: RepositorySessionState = {
    snapshot: null,
    revision: 0,
    invalidation: null,
  };

  get state(): RepositorySessionState {
    return this.value;
  }

  install(
    identity: WorkspaceSessionIdentity,
    snapshot: RepositorySnapshot | null,
    cause: SessionInvalidationCause,
    slices: Iterable<SessionInvalidationSlice>,
    options: { paths?: Iterable<string>; overflowed?: boolean } = {},
  ): RepositorySessionState {
    if (snapshot && snapshot.root !== identity.root) {
      throw new Error("Repository snapshot belongs to another workspace session.");
    }
    const invalidation = createSessionInvalidation(
      identity.root,
      identity.generation,
      slices,
      cause,
      options,
    );
    this.value = {
      snapshot,
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
  ): RepositorySessionState | null {
    const snapshot = this.value.snapshot;
    if (!snapshot || snapshot.root !== identity.root || scan.root !== identity.root) return null;
    return this.install(
      identity,
      mergeTrackedChanges(snapshot, scan),
      cause,
      ["workingTree"],
      { paths },
    );
  }

  mergeUntracked(
    identity: WorkspaceSessionIdentity,
    scan: UntrackedScan,
    cause: SessionInvalidationCause,
  ): RepositorySessionState | null {
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
    this.value = {
      snapshot: null,
      revision: this.value.revision + 1,
      invalidation: null,
    };
  }
}
