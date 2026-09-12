import type {
  CommitSelectedResult,
  RepositoryMutationOutcome,
  WorkingTreeMutationOutcome,
} from "../../models.ts";
import type { GitOperationBridge } from "../../protocol/desktop-bridge.ts";
import { invokeDesktopCommand } from "./desktop-command-adapter.ts";

export const tauriGitOperationBridge: GitOperationBridge = {
  stagePaths: (repositoryRoot, paths) =>
    invokeDesktopCommand<WorkingTreeMutationOutcome>("stage_paths", { repositoryRoot, paths }),
  unstagePaths: (repositoryRoot, paths) =>
    invokeDesktopCommand<WorkingTreeMutationOutcome>("unstage_paths", { repositoryRoot, paths }),
  commitChanges: (repositoryRoot, message, selected) =>
    invokeDesktopCommand<CommitSelectedResult>("commit_changes", {
      repositoryRoot,
      message,
      selected,
    }),
  revertChanges: (repositoryRoot, selected) =>
    invokeDesktopCommand<WorkingTreeMutationOutcome>("revert_changes", {
      repositoryRoot,
      selected,
    }),
  switchBranch: (repositoryRoot, targetFullName) =>
    invokeDesktopCommand<RepositoryMutationOutcome>("switch_branch", {
      repositoryRoot,
      targetFullName,
    }),
  createBranch: (repositoryRoot, name) =>
    invokeDesktopCommand<RepositoryMutationOutcome>("create_branch", { repositoryRoot, name }),
  fetchRemote: (repositoryRoot, remote, operationId) =>
    invokeDesktopCommand<RepositoryMutationOutcome>("fetch_remote", {
      repositoryRoot,
      remote,
      operationId,
    }),
  pullCurrent: (repositoryRoot, operationId) =>
    invokeDesktopCommand<RepositoryMutationOutcome>("pull_current", {
      repositoryRoot,
      operationId,
    }),
  pushCurrent: (repositoryRoot, remote, mode, tagMode, previewToken, operationId) =>
    invokeDesktopCommand<RepositoryMutationOutcome>("push_current", {
      repositoryRoot,
      remote,
      mode,
      tagMode,
      previewToken,
      operationId,
    }),
  cancelRemoteOperation: (repositoryRoot, operationId) =>
    invokeDesktopCommand<void>("cancel_remote_operation", { repositoryRoot, operationId }),
};
