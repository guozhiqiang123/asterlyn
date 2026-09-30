import { commandId } from "./command-service.ts";

export type BranchContextCommandAction =
  | "ref-history" | "ref-copy-name" | "ref-copy-full-name"
  | "branch-switch" | "branch-checkout-remote" | "branch-create" | "branch-rename"
  | "branch-merge" | "branch-rebase" | "branch-delete"
  | "tag-checkout" | "tag-merge" | "tag-push" | "tag-delete-local" | "tag-delete-remote";

export type HistoryContextCommandAction =
  | "load-more" | "compare-selection"
  | "commit-copy-id" | "range-copy-ids"
  | "file-show-diff" | "file-open-historical" | "file-compare-current"
  | "file-open-current" | "file-restore" | "file-history"
  | "file-copy-name" | "file-copy-relative-path" | "file-copy-absolute-path"
  | "folder-show-changes" | "folder-reveal" | "folder-history"
  | "folder-copy-name" | "folder-copy-relative-path" | "folder-copy-absolute-path"
  | BranchContextCommandAction;

export const HISTORY_COMMANDS = {
  toggleRegex: commandId("history.filter.regex.toggle"),
  toggleCase: commandId("history.filter.case.toggle"),
  openBranchFilter: commandId("history.filter.branch.open"),
  openUserFilter: commandId("history.filter.user.open"),
  openDateFilter: commandId("history.filter.date.open"),
  openPathFilter: commandId("history.filter.path.open"),
  openGraphFilter: commandId("history.filter.graph.open"),
  clearCurrentFilter: commandId("history.filter.clearCurrent"),
  clearAllFilters: commandId("history.filter.clearAll"),
  toggleFileView: commandId("history.files.view.toggle"),
  expandFiles: commandId("history.files.expandAll"),
  collapseFiles: commandId("history.files.collapseAll"),
  swapComparison: commandId("history.comparison.swap"),
  loadMore: commandId("history.loadMore"),
  compareSelection: commandId("history.selection.compare"),
  copyCommitId: commandId("history.commit.copyId"),
  copyRangeIds: commandId("history.range.copyIds"),
  openFileDiff: commandId("history.file.diff.open"),
  openHistoricalFile: commandId("history.file.openHistorical"),
  compareCurrentFile: commandId("history.file.compareCurrent"),
  openCurrentFile: commandId("history.file.openCurrent"),
  restoreFile: commandId("history.file.restore"),
  fileHistory: commandId("history.file.history"),
  showFolderChanges: commandId("history.folder.changes"),
  revealFolder: commandId("history.folder.reveal"),
  folderHistory: commandId("history.folder.history"),
  refHistory: commandId("git.ref.history"),
  copyRefName: commandId("git.ref.copyName"),
  copyRefFullName: commandId("git.ref.copyFullName"),
  switchBranch: commandId("git.branch.switch"),
  checkoutRemoteBranch: commandId("git.branch.checkoutRemote"),
  createBranch: commandId("git.branch.create"),
  renameBranch: commandId("git.branch.rename"),
  mergeBranch: commandId("git.branch.merge"),
  rebaseBranch: commandId("git.branch.rebase"),
  deleteBranch: commandId("git.branch.delete"),
  checkoutTag: commandId("git.tag.checkout"),
  mergeTag: commandId("git.tag.merge"),
  pushTag: commandId("git.tag.push"),
  deleteLocalTag: commandId("git.tag.deleteLocal"),
  deleteRemoteTag: commandId("git.tag.deleteRemote"),
  copyFileName: commandId("history.file.copyName"),
  copyFileRelativePath: commandId("history.file.copyRelativePath"),
  copyFileAbsolutePath: commandId("history.file.copyAbsolutePath"),
  copyFolderName: commandId("history.folder.copyName"),
  copyFolderRelativePath: commandId("history.folder.copyRelativePath"),
  copyFolderAbsolutePath: commandId("history.folder.copyAbsolutePath"),
} as const;
