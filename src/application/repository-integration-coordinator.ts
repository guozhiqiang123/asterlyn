import type {
  FileChange,
  GitOperationMutationOutcome,
  RepositoryMutationOutcome,
  RepositorySnapshot,
  RepositoryStateSlice,
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

const CONFLICT_MESSAGE =
  "Git paused with conflicts. Resolve the listed files from Changes, then Continue, Skip, or Abort the operation.";

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
  clearBranchSelection(): void;
  installSnapshotHistory(snapshot: RepositorySnapshot, preferTip: boolean): void;
  reconcileRefreshedHistory(snapshot: RepositorySnapshot): void;
  reconcileWorkingDocument(snapshot: RepositorySnapshot): void;
  hideHistoryTool(): void;
  showWorkspaceOnlyTools(): void;
  renderWorkspace(): void;
  loadVisibleCommitDetails(): void;
  reloadWorkingDiff(): void;
  loadProjectFiles(root: string, generation?: number): void;
  showChangesTool(): void;
  openWorkingDiff(root: string, path: string): void;
  replacementRecoveryCount(): number;
  setStatus(
    message: string,
    kind: "normal" | "busy" | "warning" | "success",
  ): void;
  reportError(error: unknown): void;
}

export interface RepositoryMutationOptions extends RepositoryChangeInstallOptions {
  readonly focusConflicts?: boolean;
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
    options: { paths?: Iterable<string>; overflowed?: boolean } = {},
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
    const snapshot = outcome.snapshot;
    const plan = repositoryReconciliationPlan(outcome);
    this.installSnapshot(snapshot, cause, plan.slices);
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
    this.targets.changes.installSnapshot(snapshot, options);
    this.targets.files.updateChanges(snapshot.changes);
    this.targets.operations.installSnapshot(snapshot);
    if (plan.reconcileOpenDocuments) this.actions.reconcileWorkingDocument(snapshot);
    if (options.focusConflicts) this.focusFirstConflict(snapshot);
    return snapshot;
  }

  reconcileWatchedRepository(
    snapshot: RepositorySnapshot | null,
    slices: RepositoryStateSlice[],
    cause: SessionInvalidationCause,
  ): void {
    this.ensureActive();
    if (!snapshot) {
      this.installSnapshot(null, cause, slices);
      this.targets.remote.installSnapshot(null);
      this.targets.changes.installSnapshot(null);
      this.targets.files.updateChanges([]);
      this.targets.history.clear();
      this.targets.operations.installSnapshot(null);
      this.actions.hideHistoryTool();
      this.actions.renderWorkspace();
      return;
    }
    this.applyMutation({ snapshot, invalidatedSlices: slices }, cause);
    this.actions.renderWorkspace();
    if (slices.includes("history")) this.actions.loadVisibleCommitDetails();
    this.actions.reloadWorkingDiff();
  }

  acceptRemoteOutcome(
    outcome: RepositoryMutationOutcome,
    focusConflicts = false,
  ): RepositorySnapshot {
    const snapshot = this.applyMutation(outcome, "remoteOperation", {
      clearInclusion: true,
      clearSelection: true,
      focusConflicts,
    });
    this.actions.renderWorkspace();
    if (outcome.invalidatedSlices.includes("history")) {
      this.actions.loadVisibleCommitDetails();
    }
    this.actions.reloadWorkingDiff();
    if (outcome.invalidatedSlices.includes("workspaceCatalog")) {
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
    this.actions.reconcileRefreshedHistory(snapshot);
    this.actions.reconcileWorkingDocument(snapshot);
    this.actions.renderWorkspace();
    this.actions.loadVisibleCommitDetails();
    this.actions.reloadWorkingDiff();
    this.actions.loadProjectFiles(snapshot.root, generation);
    return snapshot;
  }

  acceptWorkspaceReplacement(snapshot: RepositorySnapshot | null): void {
    this.installSnapshot(
      snapshot,
      "workspaceReplacement",
      ["workspaceCatalog", "openDocuments", "workingTree"],
    );
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
      this.actions.clearBranchSelection();
    }
    if (plan.updateWorkingTree) {
      this.targets.changes.installSnapshot(snapshot, options);
      this.targets.files.updateChanges(snapshot.changes);
    }
    if (plan.reloadWorkspaceCatalog) {
      this.targets.files.installWorkspace(snapshot.root, snapshot.changes);
    }
    if (plan.updateHistory) this.actions.installSnapshotHistory(snapshot, true);
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
    this.targets.remote.setDialogError(CONFLICT_MESSAGE);
    return true;
  }

  private handleSessionChange(change: WindowSessionChange): void {
    if (this.disposed) return;
    if (change.reason === "untracked-scan-start") {
      if (change.announce) this.actions.setStatus("Scanning untracked files…", "busy");
      return;
    }
    if (
      change.reason === "tracked-refresh-complete" ||
      change.reason === "untracked-scan-complete"
    ) {
      if (!change.snapshot) return;
      this.targets.changes.installSnapshot(change.snapshot);
      this.targets.files.updateChanges(change.snapshot.changes);
      this.targets.operations.installSnapshot(change.snapshot);
      this.actions.reconcileWorkingDocument(change.snapshot);
      this.actions.renderWorkspace();
      this.actions.reloadWorkingDiff();
      if (change.reason === "untracked-scan-complete" && change.announce) {
        const recoveries = this.actions.replacementRecoveryCount();
        this.actions.setStatus(
          recoveries > 0
            ? `${recoveries} replacement recovery ${recoveries === 1 ? "record needs" : "records need"} review`
            : "Ready",
          recoveries > 0 ? "warning" : "normal",
        );
      }
      return;
    }
    if (change.reason === "tracked-refresh-error") {
      this.actions.setStatus("File saved; Git status refresh failed", "warning");
      this.actions.reportError(change.error);
      return;
    }
    if (change.reason === "untracked-scan-error") {
      if (change.snapshot) this.actions.renderWorkspace();
      this.actions.reportError(change.error);
    }
  }

  private ensureActive(): void {
    if (this.disposed) throw new Error("Repository integration coordinator is disposed.");
  }
}
