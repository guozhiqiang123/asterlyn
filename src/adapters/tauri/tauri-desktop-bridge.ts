import type {
  CommitDetails,
  CommitDiffResult,
  CommitSelectedResult,
  DiffResult,
  HistoryPage,
  ImageDiffPreview,
  ImagePreview,
  OpenedProject,
  ProjectFileList,
  PushPreview,
  ReplacementApplyResult,
  ReplacementRecoverySummary,
  RepositorySnapshot,
  SaveTextFileResult,
  TextFileSnapshot,
  TrackedChangeScan,
  UntrackedScan,
  WorkspaceReplacementPreview,
  WorkspaceTextSearchReport,
} from "../../models";
import type { DesktopBridge, DirectoryChoice } from "../../protocol/desktop-bridge";
import { parseWindowChromeMode } from "../../workbench/window-chrome";
import { invokeDesktopCommand, openDialog } from "./desktop-command-adapter";

export const tauriDesktopBridge: DesktopBridge = {
  isDemo: false,

  async windowChromeMode() {
    return parseWindowChromeMode(await invokeDesktopCommand<unknown>("window_chrome_mode"));
  },

  initialRepository: () => invokeDesktopCommand<string | null>("initial_repository"),

  async chooseRepositoryDirectory(defaultPath): Promise<DirectoryChoice> {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Open Project Folder",
      defaultPath: defaultPath || undefined,
    });
    if (selected === null) return { kind: "cancelled" };
    if (Array.isArray(selected)) throw new Error("The folder chooser returned more than one path.");
    return { kind: "selected", path: selected };
  },

  openProject: (path) => invokeDesktopCommand<OpenedProject>("open_project", { path }),
  openRepositoryWindow: (path) =>
    invokeDesktopCommand<string>("open_repository_window", { path }),
  readTrackedChanges: (repositoryRoot) =>
    invokeDesktopCommand<TrackedChangeScan>("read_tracked_changes", { repositoryRoot }),
  readHistoryPage: (repositoryRoot, query, offset, limit) =>
    invokeDesktopCommand<HistoryPage>("read_history_page", {
      repositoryRoot,
      query,
      offset,
      limit,
    }),
  scanUntracked: (repositoryRoot, scanId) =>
    invokeDesktopCommand<UntrackedScan>("scan_untracked", { repositoryRoot, scanId }),
  cancelUntrackedScan: (scanId) =>
    invokeDesktopCommand<void>("cancel_untracked_scan", { scanId }),
  readDiff: (repositoryRoot, path, staged) =>
    invokeDesktopCommand<DiffResult>("read_diff", { repositoryRoot, path, staged }),
  readLocalDiff: (repositoryRoot, selected, expandedUnchanged = false) =>
    invokeDesktopCommand<DiffResult>("read_local_diff", {
      repositoryRoot,
      selected,
      expandedUnchanged,
    }),
  readImageFile: (repositoryRoot, repositoryId, path) =>
    invokeDesktopCommand<ImagePreview>("read_image_file", {
      repositoryRoot,
      repositoryId,
      path,
    }),
  readLocalImageDiff: (repositoryRoot, selected) =>
    invokeDesktopCommand<ImageDiffPreview>("read_local_image_diff", {
      repositoryRoot,
      selected,
    }),
  listProjectFiles: (repositoryRoot) =>
    invokeDesktopCommand<ProjectFileList>("list_project_files", { repositoryRoot }),
  searchWorkspaceText: (repositoryRoot, requestId, query, options) =>
    invokeDesktopCommand<WorkspaceTextSearchReport>("search_workspace_text", {
      repositoryRoot,
      requestId,
      query,
      options,
    }),
  cancelWorkspaceTextSearch: (repositoryRoot, requestId) =>
    invokeDesktopCommand<void>("cancel_workspace_text_search", { repositoryRoot, requestId }),
  previewWorkspaceReplacement: (repositoryRoot, planId, query, replacement, options) =>
    invokeDesktopCommand<WorkspaceReplacementPreview>("preview_workspace_replacement", {
      repositoryRoot,
      planId,
      query,
      replacement,
      options,
    }),
  applyWorkspaceReplacement: (repositoryRoot, planId, selectedPaths) =>
    invokeDesktopCommand<ReplacementApplyResult>("apply_workspace_replacement", {
      repositoryRoot,
      planId,
      selectedPaths,
    }),
  cancelWorkspaceReplacement: (repositoryRoot, operationId) =>
    invokeDesktopCommand<void>("cancel_workspace_replacement", { repositoryRoot, operationId }),
  listWorkspaceReplacementRecoveries: (repositoryRoot) =>
    invokeDesktopCommand<ReplacementRecoverySummary[]>(
      "list_workspace_replacement_recoveries",
      { repositoryRoot },
    ),
  rollbackWorkspaceReplacement: (repositoryRoot, recoveryId) =>
    invokeDesktopCommand<ReplacementApplyResult>("rollback_workspace_replacement", {
      repositoryRoot,
      recoveryId,
    }),
  finalizeWorkspaceReplacement: (repositoryRoot, recoveryId) =>
    invokeDesktopCommand<void>("finalize_workspace_replacement", { repositoryRoot, recoveryId }),
  readTextFile: (repositoryRoot, repositoryId, path) =>
    invokeDesktopCommand<TextFileSnapshot>("read_text_file", {
      repositoryRoot,
      repositoryId,
      path,
    }),
  saveTextFile: (
    repositoryRoot,
    repositoryId,
    path,
    expectedRevision,
    content,
    utf8Bom,
    requestId,
  ) =>
    invokeDesktopCommand<SaveTextFileResult>("save_text_file", {
      repositoryRoot,
      repositoryId,
      path,
      expectedRevision,
      content,
      utf8Bom,
      requestId,
    }),
  readCommitDetails: (repositoryRoot, repositoryId, commitOid) =>
    invokeDesktopCommand<CommitDetails>("read_commit_details", {
      repositoryRoot,
      repositoryId,
      commitOid,
    }),
  readCommitDiff: (
    repositoryRoot,
    repositoryId,
    commitOid,
    path,
    originalPath,
    expandedUnchanged = false,
  ) =>
    invokeDesktopCommand<CommitDiffResult>("read_commit_diff", {
      repositoryRoot,
      repositoryId,
      commitOid,
      path,
      originalPath,
      expandedUnchanged,
    }),
  readCommitImageDiff: (repositoryRoot, repositoryId, commitOid, path, originalPath) =>
    invokeDesktopCommand<ImageDiffPreview>("read_commit_image_diff", {
      repositoryRoot,
      repositoryId,
      commitOid,
      path,
      originalPath,
    }),
  stagePaths: (repositoryRoot, paths) =>
    invokeDesktopCommand<RepositorySnapshot>("stage_paths", { repositoryRoot, paths }),
  unstagePaths: (repositoryRoot, paths) =>
    invokeDesktopCommand<RepositorySnapshot>("unstage_paths", { repositoryRoot, paths }),
  commitChanges: (repositoryRoot, message, selected) =>
    invokeDesktopCommand<CommitSelectedResult>("commit_changes", {
      repositoryRoot,
      message,
      selected,
    }),
  revertChanges: (repositoryRoot, selected) =>
    invokeDesktopCommand<RepositorySnapshot>("revert_changes", { repositoryRoot, selected }),
  switchBranch: (repositoryRoot, targetFullName) =>
    invokeDesktopCommand<RepositorySnapshot>("switch_branch", {
      repositoryRoot,
      targetFullName,
    }),
  createBranch: (repositoryRoot, name) =>
    invokeDesktopCommand<RepositorySnapshot>("create_branch", { repositoryRoot, name }),
  fetchRemote: (repositoryRoot, remote, operationId) =>
    invokeDesktopCommand<RepositorySnapshot>("fetch_remote", {
      repositoryRoot,
      remote,
      operationId,
    }),
  readPushPreview: (repositoryRoot, remote, tagMode, offset, pageSize) =>
    invokeDesktopCommand<PushPreview>("read_push_preview", {
      repositoryRoot,
      remote,
      tagMode,
      offset,
      pageSize,
    }),
  readPushFileCommit: (repositoryRoot, remote, tagMode, previewToken, path) =>
    invokeDesktopCommand<CommitDetails | null>("read_push_file_commit", {
      repositoryRoot,
      remote,
      tagMode,
      previewToken,
      path,
    }),
  pullCurrent: (repositoryRoot, operationId) =>
    invokeDesktopCommand<RepositorySnapshot>("pull_current", { repositoryRoot, operationId }),
  pushCurrent: (repositoryRoot, remote, mode, tagMode, previewToken, operationId) =>
    invokeDesktopCommand<RepositorySnapshot>("push_current", {
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
