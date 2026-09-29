import type { ProjectFilesCopy } from "../../localization/catalog.ts";
import type {
  WorkspaceMutationOutcome,
  WorkspaceMutationRecoverySummary,
} from "../../models.ts";
import type {
  WorkspaceMutationIdentity,
  WorkspaceMutationReconciliationResult,
} from "../../application/workspace-mutation-coordinator.ts";
import { ProjectFilesOperationBinding } from "./project-files-operation-binding.ts";
import { isTextTabDirty, type TextTabState } from "./editor-session.ts";
import {
  ProjectFilesOperationController,
  type ProjectFilesMutationPort,
  type ProjectFilesOperationGateway,
  type ProjectFilesOperationMessages,
  type ProjectFilesOperationRuntime as ProjectFilesOperationControllerRuntime,
  type ProjectFilesTrashPort,
} from "./project-files-operation-controller.ts";

export interface ProjectFilesOperationRuntimeOptions {
  readonly root: HTMLElement;
  readonly gateway: ProjectFilesOperationGateway;
  readonly mutations: ProjectFilesMutationPort;
  readonly runtime: ProjectFilesOperationControllerRuntime;
  readonly messages: () => ProjectFilesOperationMessages;
  readonly trash: ProjectFilesTrashPort;
  readonly copy: () => ProjectFilesCopy;
  readonly changed: () => void;
  readonly clipboardChanged: () => void;
}

/** Owns Files mutations, its window-local clipboard, DOM binding, and subscriptions. */
export class ProjectFilesOperationRuntime {
  readonly controller: ProjectFilesOperationController;

  private readonly binding: ProjectFilesOperationBinding;
  private readonly releases: readonly (() => void)[];
  private disposed = false;

  constructor(options: ProjectFilesOperationRuntimeOptions) {
    this.controller = new ProjectFilesOperationController(
      options.gateway,
      options.mutations,
      options.runtime,
      options.messages,
      options.trash,
    );
    this.binding = new ProjectFilesOperationBinding(
      options.root,
      this.controller,
      options.copy,
    );
    this.releases = [
      this.controller.subscribe(() => {
        options.changed();
        this.binding.renderDialog();
      }),
      this.controller.clipboard.subscribe(() => options.clipboardChanged()),
    ];
  }

  bindInline(): void {
    this.binding.bindInline();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.binding.dispose();
    for (const release of this.releases) release();
    this.controller.dispose();
  }
}

export function projectFilesOperationMessages(
  labels: ProjectFilesCopy["contextMenu"],
): ProjectFilesOperationMessages {
  return {
    invalidName: labels.invalidName,
    unsafeSource: labels.unsafeSource,
    sourceChanged: labels.sourceChanged,
    destinationExists: labels.destinationExists,
    operationFailed: labels.operationFailed,
    copied: labels.copiedEntry,
    cut: labels.cutEntry,
    created: labels.createdFile,
    stagedCreated: labels.stagedCreatedFile,
    leftCreatedUntracked: labels.leftCreatedFileUntracked,
    stageCreatedFailed: labels.stageCreatedFileFailed,
    renamed: labels.renamedEntry,
    pasted: labels.pastedEntry,
    recoveryTitle: labels.recoveryTitle,
    recoveryDetail: labels.recoveryDetail,
    recoveryClose: labels.recoveryClose,
    recoveryRollback: labels.recoveryRollback,
    recoveryFinalize: labels.recoveryFinalize,
    recoveryAcknowledge: labels.recoveryAcknowledge,
    recoveryWorking: labels.recoveryWorking,
    recoveryResolved: labels.recoveryResolved,
    recoveryFailed: labels.recoveryFailed,
    recoveryDirty: labels.recoveryDirty,
    recoveryCount: labels.recoveryCount,
    recoveryPhase: labels.recoveryPhase,
    recoveryState: (state) => labels.recoveryState[state],
  };
}

export interface ProjectFilesRecoveryRuntimeOptions {
  readonly captureEditor: () => void;
  readonly textTabs: () => readonly TextTabState[];
  readonly reconcileExternalPaths: (paths: readonly string[]) => Promise<void>;
  readonly reconcileMutation: (
    identity: WorkspaceMutationIdentity,
    outcome: WorkspaceMutationOutcome,
  ) => Promise<WorkspaceMutationReconciliationResult>;
}

export function createProjectFilesRecoveryRuntime(
  options: ProjectFilesRecoveryRuntimeOptions,
): Pick<ProjectFilesOperationControllerRuntime, "recoveryBlocked" | "reconcileRecovery"> {
  return {
    recoveryBlocked: (paths, action) => {
      if (action === "acknowledge") return false;
      options.captureEditor();
      return options.textTabs().some((tab) =>
        (tab.status !== "ready" || isTextTabDirty(tab) || tab.saveRequest !== null) &&
        paths.some((path) =>
          tab.document.workspacePath === path || tab.document.workspacePath.startsWith(`${path}/`)
        )
      );
    },
    reconcileRecovery: async (identity, recovery, action) => {
      const affectedPaths = recoveryAffectedPaths(recovery);
      if (action !== "acknowledge") await options.reconcileExternalPaths(affectedPaths);
      const reconciled = await options.reconcileMutation(
        identity,
        recoveryOutcome(recovery, affectedPaths),
      );
      if (reconciled.status === "failure") throw reconciled.error;
      if (reconciled.status === "stale") throw new Error("Workspace recovery became stale.");
    },
  };
}

function recoveryAffectedPaths(recovery: WorkspaceMutationRecoverySummary): string[] {
  return Array.from(new Set([
    ...recovery.sourceStates.map((state) => state.path),
    ...(recovery.destination ? [recovery.destination] : []),
  ]));
}

function recoveryOutcome(
  recovery: WorkspaceMutationRecoverySummary,
  affectedPaths: string[],
): WorkspaceMutationOutcome {
  return {
    planId: recovery.recoveryId,
    status: "completed",
    affectedPaths,
    pathRemaps: [],
    invalidatedSlices: ["workspaceCatalog", "openDocuments", "workingTree"],
    recoveryId: null,
    error: null,
  };
}
