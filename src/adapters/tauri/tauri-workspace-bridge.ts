import type {
  ImagePreview,
  ProjectFileList,
  ReplacementApplyResult,
  ReplacementRecoverySummary,
  SaveTextFileResult,
  TextFileSnapshot,
  WorkspaceReplacementPreview,
  WorkspaceTextSearchReport,
} from "../../models.ts";
import type { WorkspaceBridge } from "../../protocol/desktop-bridge.ts";
import { invokeDesktopCommand } from "./desktop-command-adapter.ts";

export const tauriWorkspaceBridge: WorkspaceBridge = {
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
  ) => invokeDesktopCommand<SaveTextFileResult>("save_text_file", {
    repositoryRoot,
    repositoryId,
    path,
    expectedRevision,
    content,
    utf8Bom,
    requestId,
  }),
  readImageFile: (repositoryRoot, repositoryId, path) =>
    invokeDesktopCommand<ImagePreview>("read_image_file", {
      repositoryRoot,
      repositoryId,
      path,
    }),
};
