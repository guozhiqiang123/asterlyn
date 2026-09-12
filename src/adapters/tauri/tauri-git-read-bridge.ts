import type {
  CommitDetails,
  CommitDiffResult,
  DiffResult,
  HistoryPage,
  ImageDiffPreview,
  PushPreview,
  TrackedChangeScan,
  UntrackedScan,
} from "../../models.ts";
import type { GitReadBridge } from "../../protocol/desktop-bridge.ts";
import { invokeDesktopCommand } from "./desktop-command-adapter.ts";

export const tauriGitReadBridge: GitReadBridge = {
  readTrackedChanges: (repositoryRoot) =>
    invokeDesktopCommand<TrackedChangeScan>("read_tracked_changes", { repositoryRoot }),
  readHistoryPage: (repositoryRoot, query, offset, limit) =>
    invokeDesktopCommand<HistoryPage>("read_history_page", { repositoryRoot, query, offset, limit }),
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
  readLocalImageDiff: (repositoryRoot, selected) =>
    invokeDesktopCommand<ImageDiffPreview>("read_local_image_diff", { repositoryRoot, selected }),
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
  ) => invokeDesktopCommand<CommitDiffResult>("read_commit_diff", {
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
};
