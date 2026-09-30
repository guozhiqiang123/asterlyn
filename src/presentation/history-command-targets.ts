import type { CommandFocusScope, CommandId } from "../application/commands/command-service.ts";
import {
  HISTORY_COMMANDS,
  type HistoryContextCommandAction,
} from "../application/commands/history-command-ids.ts";
import type { LocaleCatalog } from "../localization/catalog.ts";
import type { DomCommandDefinition } from "./dom-command-definition.ts";

const HISTORY_SCOPES: readonly CommandFocusScope[] = ["workbench", "input", "history"];

export const HISTORY_DOM_COMMANDS: readonly DomCommandDefinition[] = [
  history(HISTORY_COMMANDS.toggleRegex, '[data-history-text-mode="regex"]', (copy) => copy.useRegularExpression, "history filter regex regular expression"),
  history(HISTORY_COMMANDS.toggleCase, '[data-history-text-mode="case"]', (copy) => copy.matchCase, "history filter match case sensitive"),
  history(HISTORY_COMMANDS.openBranchFilter, '[data-history-menu="branch"]', (copy) => copy.branchOrTag, "history branch tag reference filter"),
  history(HISTORY_COMMANDS.openUserFilter, '[data-history-menu="user"]', (copy) => copy.filterByAuthor, "history author user filter"),
  history(HISTORY_COMMANDS.openDateFilter, '[data-history-menu="date"]', (copy) => copy.filterByDate, "history date time filter"),
  history(HISTORY_COMMANDS.openPathFilter, '[data-history-menu="paths"]', (copy) => copy.filterByPathsOrRoots, "history path root file filter"),
  history(HISTORY_COMMANDS.openGraphFilter, '[data-history-menu="graph"]', (copy) => copy.graphOptions, "history graph sort options"),
  history(HISTORY_COMMANDS.toggleFileView, "#commit-file-view-toggle, #comparison-file-view-toggle, #commit-folder-file-view-toggle", (copy) => copy.showChangedFilesAs(`${copy.flatList} / ${copy.directoryTree}`), "history changed files tree flat view"),
  history(HISTORY_COMMANDS.expandFiles, "#commit-file-expand-all, #comparison-file-expand-all, #commit-folder-expand-all", (copy) => copy.expandChangedFolders, "history expand changed file folders"),
  history(HISTORY_COMMANDS.collapseFiles, "#commit-file-collapse-all, #comparison-file-collapse-all, #commit-folder-collapse-all", (copy) => copy.collapseChangedFolders, "history collapse changed file folders"),
  history(HISTORY_COMMANDS.swapComparison, "#swap-comparison-sides", (copy) => copy.swapComparisonSides, "history comparison swap before after sides"),
];

export interface HistoryContextCommandDefinition {
  readonly id: CommandId;
  readonly action: HistoryContextCommandAction;
  readonly scopes: readonly CommandFocusScope[];
  readonly title: (catalog: LocaleCatalog) => string;
  readonly detail: (catalog: LocaleCatalog) => string;
  readonly keywords: string;
}

export const HISTORY_CONTEXT_COMMANDS: readonly HistoryContextCommandDefinition[] = [
  context(HISTORY_COMMANDS.loadMore, "load-more", (copy) => copy.scrollForOlder, "history load more older commits page"),
  context(HISTORY_COMMANDS.compareSelection, "compare-selection", (copy) => copy.rangeContextMenu.compareTwoCommits, "history compare two selected commits"),
  context(HISTORY_COMMANDS.openFileDiff, "file-show-diff", (copy) => copy.commitFileContextMenu.showDiff, "history selected file diff"),
  context(HISTORY_COMMANDS.openHistoricalFile, "file-open-historical", (copy) => copy.commitFileContextMenu.openHistorical, "history open selected historical file version"),
  context(HISTORY_COMMANDS.compareCurrentFile, "file-compare-current", (copy) => copy.commitFileContextMenu.compareCurrent, "history compare selected file current working tree"),
  context(HISTORY_COMMANDS.openCurrentFile, "file-open-current", (copy) => copy.commitFileContextMenu.openCurrent, "history open current selected file"),
  context(HISTORY_COMMANDS.restoreFile, "file-restore", (copy) => copy.commitFileContextMenu.restore, "history restore selected file version working tree"),
  context(HISTORY_COMMANDS.fileHistory, "file-history", (copy) => copy.commitFileContextMenu.historyUpToCommit, "history selected file path up to commit"),
  context(HISTORY_COMMANDS.showFolderChanges, "folder-show-changes", (copy) => copy.commitFolderContextMenu.showChanges, "history focused folder changes"),
  context(HISTORY_COMMANDS.revealFolder, "folder-reveal", (copy) => copy.commitFolderContextMenu.revealInFiles, "history reveal focused folder files"),
  context(HISTORY_COMMANDS.folderHistory, "folder-history", (copy) => copy.commitFolderContextMenu.historyUpToCommit, "history focused folder path up to commit"),
];

function history(
  id: CommandId,
  selector: string,
  title: (copy: LocaleCatalog["history"]) => string,
  keywords: string,
): DomCommandDefinition {
  return {
    id, selector, keywords, category: "workspace", scopes: HISTORY_SCOPES,
    title: (catalog) => title(catalog.history),
    detail: (catalog) => catalog.shell.branches,
    blockedReason: (catalog) => catalog.settings.keybindings.historyRequired,
  };
}

function context(
  id: CommandId,
  action: HistoryContextCommandAction,
  title: (copy: LocaleCatalog["history"]) => string,
  keywords: string,
): HistoryContextCommandDefinition {
  return {
    id, action, keywords, scopes: HISTORY_SCOPES,
    title: (catalog) => title(catalog.history),
    detail: (catalog) => catalog.shell.branches,
  };
}
