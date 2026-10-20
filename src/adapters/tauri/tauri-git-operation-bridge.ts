import type {
  BranchMutationPlan,
  CommitSelectedResult,
  RestoreChangesPlan,
  GitWorktreeRecovery,
  GitConflictContent,
  GitOperationMutationOutcome,
  GitOperationPlan,
  GitOperationSnapshot,
  GitResetPlan,
  HeadCommitMutationKind,
  RemoteAuthenticationStatus,
  RemoteMutationPlan,
  RepositoryMutationOutcome,
  StashMutationRequest,
  TagMutationRequest,
  WorkingTreeMutationOutcome,
  WorktreeCreationPlan,
} from "../../models.ts";
import type { GitOperationBridge } from "../../protocol/desktop-bridge.ts";
import { invokeDesktopCommand } from "./desktop-command-adapter.ts";

export const tauriGitOperationBridge: GitOperationBridge = {
  stagePaths: (repositoryRoot, repositoryId, paths) =>
    invokeDesktopCommand<WorkingTreeMutationOutcome>("stage_paths", { repositoryRoot, repositoryId, paths }),
  trashUntrackedPaths: (repositoryRoot, repositoryId, paths) =>
    invokeDesktopCommand<WorkingTreeMutationOutcome>("trash_untracked_paths", { repositoryRoot, repositoryId, paths }),
  unstagePaths: (repositoryRoot, repositoryId, paths) =>
    invokeDesktopCommand<WorkingTreeMutationOutcome>("unstage_paths", { repositoryRoot, repositoryId, paths }),
  commitChanges: (repositoryRoot, message, selected) =>
    invokeDesktopCommand<CommitSelectedResult>("commit_changes", {
      repositoryRoot,
      message,
      selected,
    }),
  stashChanges: (repositoryRoot, message, selected, keepIndex) =>
    invokeDesktopCommand<RepositoryMutationOutcome>("stash_changes", {
      repositoryRoot,
      message,
      selected,
      keepIndex,
    }),
  prepareRestoreChanges: (repositoryRoot, selected) =>
    invokeDesktopCommand<RestoreChangesPlan>("prepare_restore_changes", { repositoryRoot, selected }),
  listGitWorktreeRecoveries: (repositoryRoot) =>
    invokeDesktopCommand<GitWorktreeRecovery[]>("list_git_worktree_recoveries", { repositoryRoot }),
  undoGitWorktreeRecovery: (repositoryRoot, recoveryId) =>
    invokeDesktopCommand<RepositoryMutationOutcome>("undo_git_worktree_recovery", { repositoryRoot, recoveryId }),
  revertChanges: (repositoryRoot, plan) =>
    invokeDesktopCommand<WorkingTreeMutationOutcome>("revert_changes", {
      repositoryRoot,
      plan,
    }),
  switchBranch: (repositoryRoot, targetFullName) =>
    invokeDesktopCommand<RepositoryMutationOutcome>("switch_branch", {
      repositoryRoot,
      targetFullName,
    }),
  createBranch: (repositoryRoot, name) =>
    invokeDesktopCommand<RepositoryMutationOutcome>("create_branch", { repositoryRoot, name }),
  prepareBranchMutation: (repositoryRoot, request) =>
    invokeDesktopCommand<BranchMutationPlan>("prepare_branch_mutation", { repositoryRoot, request }),
  executeBranchMutation: (repositoryRoot, plan, operationId) =>
    invokeDesktopCommand<RepositoryMutationOutcome>("execute_branch_mutation", {
      repositoryRoot,
      plan,
      operationId,
    }),
  prepareWorktreeCreation: (repositoryRoot, request) =>
    invokeDesktopCommand<WorktreeCreationPlan>("prepare_worktree_creation", {
      repositoryRoot,
      request,
    }),
  executeWorktreeCreation: (repositoryRoot, plan) =>
    invokeDesktopCommand<RepositoryMutationOutcome>("execute_worktree_creation", {
      repositoryRoot,
      plan,
    }),
  executeTagMutation: (repositoryRoot, request: TagMutationRequest, operationId) =>
    invokeDesktopCommand<RepositoryMutationOutcome>("execute_tag_mutation", {
      repositoryRoot,
      request,
      operationId,
    }),
  executeStashMutation: (repositoryRoot, request: StashMutationRequest) =>
    invokeDesktopCommand<RepositoryMutationOutcome>("execute_stash_mutation", {
      repositoryRoot,
      request,
    }),
  prepareRemoteMutation: (repositoryRoot, request) =>
    invokeDesktopCommand<RemoteMutationPlan>("prepare_remote_mutation", { repositoryRoot, request }),
  executeRemoteMutation: (repositoryRoot, plan) =>
    invokeDesktopCommand<RepositoryMutationOutcome>("execute_remote_mutation", {
      repositoryRoot,
      plan,
    }),
  prepareGitReset: (repositoryRoot, targetOid) =>
    invokeDesktopCommand<GitResetPlan>("prepare_git_reset", { repositoryRoot, targetOid }),
  executeGitReset: (repositoryRoot, plan, mode) =>
    invokeDesktopCommand<RepositoryMutationOutcome>("execute_git_reset", {
      repositoryRoot,
      plan,
      mode,
    }),
  prepareHeadCommitMutation: (repositoryRoot, selectedHeadOid, kind: HeadCommitMutationKind) =>
    invokeDesktopCommand<GitResetPlan>("prepare_head_commit_mutation", {
      repositoryRoot,
      selectedHeadOid,
      kind,
    }),
  executeHeadCommitMutation: (repositoryRoot, plan, kind: HeadCommitMutationKind) =>
    invokeDesktopCommand<RepositoryMutationOutcome>("execute_head_commit_mutation", {
      repositoryRoot,
      plan,
      kind,
    }),
  readRemoteAuthentication: (repositoryRoot, repositoryId, remote) =>
    invokeDesktopCommand<RemoteAuthenticationStatus>("read_remote_authentication", {
      repositoryRoot,
      repositoryId,
      remote,
    }),
  storeRemoteHttpsCredential: (repositoryRoot, repositoryId, remote, username, token) =>
    invokeDesktopCommand<RemoteAuthenticationStatus>("store_remote_https_credential", {
      repositoryRoot,
      repositoryId,
      remote,
      username,
      token,
    }),
  configureRemoteSsh: (repositoryRoot, repositoryId, remote, sshUrl) =>
    invokeDesktopCommand<RemoteAuthenticationStatus>("configure_remote_ssh", {
      repositoryRoot,
      repositoryId,
      remote,
      sshUrl,
    }),
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
  updateLocalBranch: (repositoryRoot, sourceBranch, expectedOid, operationId) =>
    invokeDesktopCommand<RepositoryMutationOutcome>("update_local_branch", {
      repositoryRoot,
      sourceBranch,
      expectedOid,
      operationId,
    }),
  pushCurrent: (
    repositoryRoot,
    repositoryId,
    remote,
    mode,
    tagMode,
    previewToken,
    operationId,
    destinationBranch,
    sourceBranch,
  ) =>
    invokeDesktopCommand<RepositoryMutationOutcome>("push_current", {
      repositoryRoot,
      repositoryId,
      remote,
      mode,
      tagMode,
      previewToken,
      operationId,
      destinationBranch: destinationBranch ?? null,
      sourceBranch: sourceBranch ?? null,
    }),
  cancelRemoteOperation: (repositoryRoot, operationId) =>
    invokeDesktopCommand<void>("cancel_remote_operation", { repositoryRoot, operationId }),
  readGitOperation: (repositoryRoot) =>
    invokeDesktopCommand<GitOperationSnapshot | null>("read_git_operation", { repositoryRoot }),
  prepareGitOperation: (repositoryRoot, kind, targetRefs, message) =>
    invokeDesktopCommand<GitOperationPlan>("prepare_git_operation", {
      repositoryRoot,
      kind,
      targetRefs,
      message,
    }),
  executeGitOperation: (repositoryRoot, plan) =>
    invokeDesktopCommand<RepositoryMutationOutcome>("execute_git_operation", {
      repositoryRoot,
      plan,
    }),
  runGitOperationAction: (repositoryRoot, action) =>
    invokeDesktopCommand<RepositoryMutationOutcome>("run_git_operation_action", {
      repositoryRoot,
      action,
    }),
  readConflictContent: (repositoryRoot, path) =>
    invokeDesktopCommand<GitConflictContent>("read_conflict_content", { repositoryRoot, path }),
  resolveConflict: (repositoryRoot, path, expectedRevisionToken, content) =>
    invokeDesktopCommand<GitOperationMutationOutcome>("resolve_conflict", {
      repositoryRoot,
      path,
      expectedRevisionToken,
      content,
    }),
};
