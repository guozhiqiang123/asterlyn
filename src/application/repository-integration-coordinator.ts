import type {
  FileChange,
  GitOperationMutationOutcome,
  OpenedProject,
  RepositoryMutationOutcome,
  RepositorySnapshot,
  WorkspaceMutationOutcome,
  WorkingTreeMutationOutcome,
} from "../models.ts";
import {
  repositoryReconciliationPlan,
  type RepositoryReconciliationPlan,
} from "./repository-mutation.ts";
import type {
  SessionInvalidationCause,
  SessionInvalidationSlice,
} from "./session-invalidation.ts";
import type { WindowSession, WindowSessionChange } from "./window-session.ts";
import type { RepositoryReadLease } from "./repository-session.ts";

export interface RepositoryIntegrationMessages {
  readonly conflictPaused: string;
  readonly scanningUntracked: string;
  readonly ready: string;
  readonly fileSavedRefreshFailed: string;
  recoveryCount(count: number): string;
}

const DEFAULT_MESSAGES: RepositoryIntegrationMessages = {
  conflictPaused: "Git paused with conflicts. Resolve the listed files from Changes, then Continue, Skip, or Abort the operation.",
  scanningUntracked: "Scanning untracked files…",
  ready: "Ready",
  fileSavedRefreshFailed: "File saved; Git status refresh failed",
  recoveryCount: (count) => `${count} replacement recovery ${count === 1 ? "record needs" : "records need"} review`,
};

interface RemoteSnapshotTarget {
  installSnapshot(snapshot: RepositorySnapshot | null): void;
  setDialogError(message: string | null): void;
}

export interface RepositoryChangeInstallOptions {
  readonly clearInclusion?: boolean;
  readonly clearDisclosure?: boolean;
  readonly clearSelection?: boolean;
}

interface ChangesSnapshotTarget {
  installSnapshot(
    snapshot: RepositorySnapshot | null,
    options?: RepositoryChangeInstallOptions,
  ): void;
  selectConflict(path: string): boolean;
}

interface FilesSnapshotTarget {
  installWorkspace(root: string | null, changes?: FileChange[]): void;
  updateChanges(changes: FileChange[]): void;
}

interface HistorySnapshotTarget {
  clear(): void;
}

interface OperationSnapshotTarget {
  installSnapshot(snapshot: RepositorySnapshot | null): void;
}

export interface RepositoryIntegrationTargets {
  readonly remote: RemoteSnapshotTarget;
  readonly changes: ChangesSnapshotTarget;
  readonly files: FilesSnapshotTarget;
  readonly history: HistorySnapshotTarget;
  readonly operations: OperationSnapshotTarget;
}

export interface RepositoryIntegrationActions {
  reconcileRefreshedHistory(snapshot: RepositorySnapshot, preferTip: boolean): void;
  reconcileWorkingDocument(snapshot: RepositorySnapshot, reloadIfValid?: boolean): void;
  hideHistoryTool(): void;
  showWorkspaceOnlyTools(): void;
  renderWorkspace(): void;
  renderRepositorySlices(
    snapshot: RepositorySnapshot,
    slices: Iterable<SessionInvalidationSlice>,
  ): void;
  loadVisibleCommitDetails(): void;
  loadProjectFiles(root: string, generation?: number): void;
  showChangesTool(): void;
  openWorkingDiff(root: string, path: string): void;
  replacementRecoveryCount(): number;
  setStatus(
    message: string,
    kind: "normal" | "busy" | "warning" | "success",
  ): void;
  reportError(error: unknown): void;
  messages?(): RepositoryIntegrationMessages;
}

export interface RepositoryMutationOptions extends RepositoryChangeInstallOptions {
  readonly focusConflicts?: boolean;
  readonly preferHistoryTip?: boolean;
}

/**
 * Applies canonical repository results to feature-owned projections.
 *
 * The coordinator owns no repository truth. WindowSession installs every accepted result first;
 * this class then fans the declared invalidation slices out to the affected feature controllers.
 */
export class RepositoryIntegrationCoordinator {
  private readonly session: WindowSession;
  private readonly targets: RepositoryIntegrationTargets;
  private readonly actions: RepositoryIntegrationActions;
  private readonly releaseSession: () => void;
  private disposed = false;

  constructor(
    session: WindowSession,
    targets: RepositoryIntegrationTargets,
    actions: RepositoryIntegrationActions,
  ) {
    this.session = session;
    this.targets = targets;
    this.actions = actions;
    this.releaseSession = session.subscribe((change) => this.handleSessionChange(change));
  }

  installSnapshot(
    snapshot: RepositorySnapshot | null,
    cause: SessionInvalidationCause,
    slices: Iterable<SessionInvalidationSlice>,
    options: { paths?: Iterable<string>; recovery?: import("../models.ts").WorkspaceWatchRecovery } = {},
  ): RepositorySnapshot | null {
    this.ensureActive();
    const installed = this.session.installRepository(snapshot, cause, slices, options);
    this.session.repository.consumeInvalidation();
    return installed;
  }

  applyMutation(
    outcome: RepositoryMutationOutcome,
    cause: SessionInvalidationCause,
    options: RepositoryMutationOptions = {},
  ): RepositorySnapshot {
    this.ensureActive();
    const plan = repositoryReconciliationPlan(outcome);
    const snapshot = this.installSnapshot(outcome.snapshot, cause, plan.slices);
    if (!snapshot) throw new Error("Repository mutation removed the active Git capability.");
    this.applyPlan(snapshot, plan, options);
    return snapshot;
  }

  applyWorkingTreeMutation(
    outcome: WorkingTreeMutationOutcome,
    options: RepositoryChangeInstallOptions = {},
  ): RepositorySnapshot {
    this.ensureActive();
    const plan = repositoryReconciliationPlan(outcome);
    const snapshot = this.session.installTracked(
      outcome.tracked,
      "gitMutation",
      plan.slices,
    );
    if (!snapshot) throw new Error("Working-tree result belongs to a stale repository session.");
    this.session.repository.consumeInvalidation();
    if (plan.updateRemote) this.targets.remote.installSnapshot(snapshot);
    this.targets.changes.installSnapshot(snapshot, options);
    this.targets.files.updateChanges(snapshot.changes);
    if (plan.reconcileOpenDocuments) this.actions.reconcileWorkingDocument(snapshot);
    return snapshot;
  }

  applyGitOperationMutation(
    outcome: GitOperationMutationOutcome,
    options: RepositoryMutationOptions = {},
  ): RepositorySnapshot {
    this.ensureActive();
    const plan = repositoryReconciliationPlan(outcome);
    const snapshot = this.session.installTrackedOperation(
      outcome.tracked,
      outcome.operation,
      "gitMutation",
      plan.slices,
    );
    if (!snapshot) throw new Error("Git-operation result belongs to a stale repository session.");
    this.session.repository.consumeInvalidation();
    if (plan.updateRemote) this.targets.remote.installSnapshot(snapshot);
    this.targets.changes.installSnapshot(snapshot, options);
    this.targets.files.updateChanges(snapshot.changes);
    this.targets.operations.installSnapshot(snapshot);
    if (plan.reconcileOpenDocuments) this.actions.reconcileWorkingDocument(snapshot);
    if (options.focusConflicts) this.focusFirstConflict(snapshot);
    return snapshot;
  }

  reconcileWatchedRepository(
    project: OpenedProject,
    lease: RepositoryReadLease,
    cause: SessionInvalidationCause,
  ): boolean {
    this.ensureActive();
    const previous = this.session.repository.state.snapshot;
    const committed = this.session.installRepositoryRead(lease, project, cause);
    if (!committed) return false;
    this.session.repository.consumeInvalidation();
    const snapshot = committed.state.snapshot;
    if (!snapshot) {
      this.targets.remote.installSnapshot(null);
      this.targets.changes.installSnapshot(null);
      this.targets.files.updateChanges([]);
      this.targets.history.clear();
      this.targets.operations.installSnapshot(null);
      this.actions.hideHistoryTool();
      this.actions.renderWorkspace();
      return true;
    }
    const slices = changedProjectionSlices(previous, snapshot, committed.slices);
    this.applyPlan(
      snapshot,
      repositoryReconciliationPlan({ invalidatedSlices: slices }),
      { preferHistoryTip: false },
    );
    if (slices.length > 0) this.actions.renderRepositorySlices(snapshot, slices);
    if (slices.includes("workingTree") && snapshot.untrackedState === "pending") {
      void this.session.scanUntracked(snapshot.root, this.session.generation, false, cause);
    }
    return true;
  }

  acceptRemoteOutcome(
    outcome: RepositoryMutationOutcome,
    focusConflicts = false,
    preferHistoryTip = true,
  ): RepositorySnapshot {
    this.ensureActive();
    const previous = this.session.repository.state.snapshot;
    const declaredPlan = repositoryReconciliationPlan(outcome);
    const snapshot = this.installSnapshot(outcome.snapshot, "remoteOperation", declaredPlan.slices);
    if (!snapshot) throw new Error("Remote result removed the active Git capability.");
    const slices = changedProjectionSlices(previous, snapshot, declaredPlan.slices);
    const plan = repositoryReconciliationPlan({ invalidatedSlices: slices });
    this.applyPlan(snapshot, plan, {
      clearInclusion: true,
      clearSelection: true,
      focusConflicts,
      preferHistoryTip,
    });
    if (slices.length > 0) this.actions.renderRepositorySlices(snapshot, slices);
    if (slices.includes("workspaceCatalog")) {
      this.actions.loadProjectFiles(snapshot.root);
    }
    return snapshot;
  }

  acceptManualRefresh(
    workspaceRoot: string,
    snapshot: RepositorySnapshot | null,
    generation: number,
  ): RepositorySnapshot | null {
    this.ensureActive();
    if (!this.session.matches(generation, workspaceRoot)) return null;
    if (snapshot && snapshot.root !== workspaceRoot) {
      throw new Error("Manual refresh result belongs to another workspace session.");
    }
    this.session.repository.consumeInvalidation();
    if (!snapshot) {
      this.targets.history.clear();
      this.targets.remote.installSnapshot(null);
      this.targets.changes.installSnapshot(null);
      this.targets.files.installWorkspace(workspaceRoot, []);
      this.targets.operations.installSnapshot(null);
      this.actions.showWorkspaceOnlyTools();
      this.actions.renderWorkspace();
      this.actions.loadProjectFiles(workspaceRoot, generation);
      return null;
    }
    this.targets.remote.installSnapshot(snapshot);
    this.targets.changes.installSnapshot(snapshot);
    this.targets.files.installWorkspace(snapshot.root, snapshot.changes);
    this.targets.operations.installSnapshot(snapshot);
    this.actions.reconcileRefreshedHistory(snapshot, false);
    this.actions.reconcileWorkingDocument(snapshot);
    this.actions.renderWorkspace();
    this.actions.loadVisibleCommitDetails();
    this.actions.loadProjectFiles(snapshot.root, generation);
    return snapshot;
  }

  acceptWorkspaceReplacement(snapshot: RepositorySnapshot | null): void {
    this.installSnapshot(
      snapshot,
      "workspaceReplacement",
      ["workspaceCatalog", "openDocuments", "workingTree"],
    );
    this.targets.remote.installSnapshot(snapshot);
    if (snapshot) {
      this.targets.changes.installSnapshot(snapshot);
      this.targets.files.updateChanges(snapshot.changes);
      this.targets.operations.installSnapshot(snapshot);
      this.actions.reconcileWorkingDocument(snapshot);
    } else {
      this.targets.changes.installSnapshot(null);
      this.targets.files.updateChanges([]);
      this.targets.operations.installSnapshot(null);
    }
    this.actions.renderWorkspace();
  }

  acceptWorkspaceMutation(
    snapshot: RepositorySnapshot | null,
    outcome: WorkspaceMutationOutcome,
  ): void {
    this.ensureActive();
    const previous = this.session.repository.state.snapshot;
    const installed = this.installSnapshot(
      snapshot,
      "workspaceMutation",
      outcome.invalidatedSlices,
      { paths: outcome.affectedPaths },
    );
    const capabilityChanged = previous?.gitDir !== installed?.gitDir;
    if (capabilityChanged) {
      this.targets.remote.installSnapshot(installed);
      this.targets.changes.installSnapshot(installed);
      this.targets.files.installWorkspace(
        installed?.root ?? this.session.workspace.state.root,
        installed?.changes ?? [],
      );
      this.targets.operations.installSnapshot(installed);
      if (installed) this.actions.reconcileRefreshedHistory(installed, false);
      else this.targets.history.clear();
      this.actions.renderWorkspace();
      return;
    }
    if (outcome.invalidatedSlices.includes("workingTree")) {
      this.targets.changes.installSnapshot(installed);
      this.targets.files.updateChanges(installed?.changes ?? []);
    }
    if (outcome.invalidatedSlices.includes("openDocuments") && installed) {
      this.actions.reconcileWorkingDocument(installed);
    }
    if (installed) this.actions.renderRepositorySlices(installed, outcome.invalidatedSlices);
    else this.actions.renderWorkspace();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseSession();
  }

  private applyPlan(
    snapshot: RepositorySnapshot,
    plan: RepositoryReconciliationPlan,
    options: RepositoryMutationOptions,
  ): void {
    if (plan.updateRemote) {
      this.targets.remote.installSnapshot(snapshot);
    }
    if (plan.updateWorkingTree) {
      this.targets.changes.installSnapshot(snapshot, options);
      this.targets.files.updateChanges(snapshot.changes);
    }
    if (plan.reloadWorkspaceCatalog) {
      this.targets.files.installWorkspace(snapshot.root, snapshot.changes);
    }
    if (plan.updateHistory) {
      this.actions.reconcileRefreshedHistory(
        snapshot,
        options.preferHistoryTip ?? true,
      );
    }
    if (plan.reconcileOperation) this.targets.operations.installSnapshot(snapshot);
    if (plan.reconcileOpenDocuments) this.actions.reconcileWorkingDocument(snapshot);
    if (options.focusConflicts) this.focusFirstConflict(snapshot);
  }

  private focusFirstConflict(snapshot: RepositorySnapshot): boolean {
    const conflict = snapshot.changes.find((change) => change.conflicted);
    if (!conflict) return false;
    this.actions.showChangesTool();
    this.targets.changes.selectConflict(conflict.path);
    this.actions.openWorkingDiff(snapshot.root, conflict.path);
    this.targets.remote.setDialogError(this.messages().conflictPaused);
    return true;
  }

  private handleSessionChange(change: WindowSessionChange): void {
    if (this.disposed) return;
    if (change.reason === "untracked-scan-start") {
      if (change.announce) this.actions.setStatus(this.messages().scanningUntracked, "busy");
      return;
    }
    if (
      change.reason === "tracked-refresh-complete" ||
      change.reason === "untracked-scan-complete"
    ) {
      if (!change.snapshot) return;
      this.targets.remote.installSnapshot(change.snapshot);
      this.targets.changes.installSnapshot(change.snapshot);
      this.targets.files.updateChanges(change.snapshot.changes);
      this.targets.operations.installSnapshot(change.snapshot);
      this.actions.reconcileWorkingDocument(
        change.snapshot,
        change.reason !== "untracked-scan-complete",
      );
      this.actions.renderRepositorySlices(change.snapshot, ["workingTree"]);
      if (change.reason === "untracked-scan-complete" && change.announce) {
        const recoveries = this.actions.replacementRecoveryCount();
        this.actions.setStatus(
          recoveries > 0 ? this.messages().recoveryCount(recoveries) : this.messages().ready,
          recoveries > 0 ? "warning" : "success",
        );
      }
      return;
    }
    if (change.reason === "tracked-refresh-error") {
      this.actions.setStatus(this.messages().fileSavedRefreshFailed, "warning");
      this.actions.reportError(change.error);
      return;
    }
    if (change.reason === "untracked-scan-error") {
      if (change.snapshot) {
        this.targets.remote.installSnapshot(change.snapshot);
        this.targets.changes.installSnapshot(change.snapshot);
        this.targets.files.updateChanges(change.snapshot.changes);
        this.targets.operations.installSnapshot(change.snapshot);
        this.actions.renderRepositorySlices(change.snapshot, ["workingTree"]);
      }
      this.actions.reportError(change.error);
    }
  }

  private ensureActive(): void {
    if (this.disposed) throw new Error("Repository integration coordinator is disposed.");
  }

  private messages(): RepositoryIntegrationMessages {
    return this.actions.messages?.() ?? DEFAULT_MESSAGES;
  }
}

function changedProjectionSlices(
  previous: RepositorySnapshot | null,
  next: RepositorySnapshot,
  slices: Iterable<SessionInvalidationSlice>,
): SessionInvalidationSlice[] {
  return Array.from(slices).filter((slice) => {
    if (!previous || previous.root !== next.root || previous.gitDir !== next.gitDir) return true;
    switch (slice) {
      case "repositoryCapability":
        return false;
      case "workingTree":
        return previous.untrackedState !== next.untrackedState ||
          !sameProjection(previous.changes, next.changes);
      case "head":
        return !sameProjection(previous.branch, next.branch);
      case "refs":
        return !sameProjection(
          [previous.repositoryRoots, previous.branches, previous.remotes],
          [next.repositoryRoots, next.branches, next.remotes],
        );
      case "history":
        return !sameProjection(previous.commits, next.commits);
      case "operation":
        return !sameProjection(previous.operation, next.operation);
      case "workspaceCatalog":
      case "openDocuments":
        return true;
    }
  });
}

function sameProjection(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}
