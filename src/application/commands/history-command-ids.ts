import { commandId } from "./command-service.ts";

export type HistoryContextCommandAction =
  | "load-more" | "compare-selection"
  | "file-show-diff" | "file-open-historical" | "file-compare-current"
  | "file-open-current" | "file-restore" | "file-history"
  | "folder-show-changes" | "folder-reveal" | "folder-history";

export const HISTORY_COMMANDS = {
  toggleRegex: commandId("history.filter.regex.toggle"),
  toggleCase: commandId("history.filter.case.toggle"),
  openBranchFilter: commandId("history.filter.branch.open"),
  openUserFilter: commandId("history.filter.user.open"),
  openDateFilter: commandId("history.filter.date.open"),
  openPathFilter: commandId("history.filter.path.open"),
  openGraphFilter: commandId("history.filter.graph.open"),
  toggleFileView: commandId("history.files.view.toggle"),
  expandFiles: commandId("history.files.expandAll"),
  collapseFiles: commandId("history.files.collapseAll"),
  swapComparison: commandId("history.comparison.swap"),
  loadMore: commandId("history.loadMore"),
  compareSelection: commandId("history.selection.compare"),
  openFileDiff: commandId("history.file.diff.open"),
  openHistoricalFile: commandId("history.file.openHistorical"),
  compareCurrentFile: commandId("history.file.compareCurrent"),
  openCurrentFile: commandId("history.file.openCurrent"),
  restoreFile: commandId("history.file.restore"),
  fileHistory: commandId("history.file.history"),
  showFolderChanges: commandId("history.folder.changes"),
  revealFolder: commandId("history.folder.reveal"),
  folderHistory: commandId("history.folder.history"),
} as const;
