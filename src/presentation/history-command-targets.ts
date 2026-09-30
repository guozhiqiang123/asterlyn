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
  history(HISTORY_COMMANDS.clearCurrentFilter, "[data-history-clear-filter]", (copy) => copy.clearCurrentFilter, "clear current active history filter"),
  history(HISTORY_COMMANDS.clearAllFilters, "[data-history-clear-all]", (copy) => copy.clearAllFilters, "clear reset all active history filters"),
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
  context(HISTORY_COMMANDS.copyCommitId, "commit-copy-id", (copy) => copy.commitContextMenu.copyCommitId, "copy selected history commit full id hash oid"),
  context(HISTORY_COMMANDS.copyRangeIds, "range-copy-ids", (copy) => copy.rangeContextMenu.copyCommitIds, "copy selected history commit range full ids hashes oids"),
  context(HISTORY_COMMANDS.openFileDiff, "file-show-diff", (copy) => copy.commitFileContextMenu.showDiff, "history selected file diff"),
  context(HISTORY_COMMANDS.openHistoricalFile, "file-open-historical", (copy) => copy.commitFileContextMenu.openHistorical, "history open selected historical file version"),
  context(HISTORY_COMMANDS.compareCurrentFile, "file-compare-current", (copy) => copy.commitFileContextMenu.compareCurrent, "history compare selected file current working tree"),
  context(HISTORY_COMMANDS.openCurrentFile, "file-open-current", (copy) => copy.commitFileContextMenu.openCurrent, "history open current selected file"),
  context(HISTORY_COMMANDS.restoreFile, "file-restore", (copy) => copy.commitFileContextMenu.restore, "history restore selected file version working tree"),
  context(HISTORY_COMMANDS.fileHistory, "file-history", (copy) => copy.commitFileContextMenu.historyUpToCommit, "history selected file path up to commit"),
  context(HISTORY_COMMANDS.showFolderChanges, "folder-show-changes", (copy) => copy.commitFolderContextMenu.showChanges, "history focused folder changes"),
  context(HISTORY_COMMANDS.revealFolder, "folder-reveal", (copy) => copy.commitFolderContextMenu.revealInFiles, "history reveal focused folder files"),
  context(HISTORY_COMMANDS.folderHistory, "folder-history", (copy) => copy.commitFolderContextMenu.historyUpToCommit, "history focused folder path up to commit"),
  context(HISTORY_COMMANDS.refHistory, "ref-history", (copy) => copy.branchContextMenu.viewHistory, "git selected branch tag reference history"),
  context(HISTORY_COMMANDS.copyRefName, "ref-copy-name", (copy) => copy.branchContextMenu.shortName, "copy selected branch tag short name"),
  context(HISTORY_COMMANDS.copyRefFullName, "ref-copy-full-name", (copy) => copy.branchContextMenu.fullReference, "copy selected branch tag full reference"),
  context(HISTORY_COMMANDS.switchBranch, "branch-switch", (copy) => copy.branchMutation.titles.switch, "git switch selected local branch"),
  context(HISTORY_COMMANDS.checkoutRemoteBranch, "branch-checkout-remote", (copy) => copy.branchMutation.titles.checkoutRemote, "git checkout selected remote branch"),
  context(HISTORY_COMMANDS.createBranch, "branch-create", (copy) => copy.branchMutation.titles.create, "git create branch from selected reference"),
  context(HISTORY_COMMANDS.renameBranch, "branch-rename", (copy) => copy.branchMutation.titles.rename, "git rename selected local branch"),
  context(HISTORY_COMMANDS.mergeBranch, "branch-merge", (copy) => copy.branchContextMenu.mergeIntoCurrent, "git merge selected branch into current"),
  context(HISTORY_COMMANDS.rebaseBranch, "branch-rebase", (copy) => copy.branchContextMenu.rebaseCurrentOnto, "git rebase current onto selected branch"),
  context(HISTORY_COMMANDS.deleteBranch, "branch-delete", (copy) => copy.branchMutation.titles.delete, "git delete selected local branch"),
  context(HISTORY_COMMANDS.checkoutTag, "tag-checkout", (copy) => copy.tagMutation.titles.checkout, "git checkout selected tag detached head"),
  context(HISTORY_COMMANDS.mergeTag, "tag-merge", (copy) => copy.branchContextMenu.mergeIntoCurrent, "git merge selected tag into current branch"),
  context(HISTORY_COMMANDS.pushTag, "tag-push", (copy) => copy.tagMutation.titles.push, "git push selected tag to selected remote"),
  context(HISTORY_COMMANDS.deleteLocalTag, "tag-delete-local", (copy) => copy.tagMutation.titles.deleteLocal, "git delete selected local tag"),
  context(HISTORY_COMMANDS.deleteRemoteTag, "tag-delete-remote", (copy) => copy.tagMutation.titles.deleteRemote, "git delete selected tag from selected remote"),
  context(HISTORY_COMMANDS.copyFileName, "file-copy-name", (copy) => copy.commitFileContextMenu.fileName, "copy selected historical file name"),
  context(HISTORY_COMMANDS.copyFileRelativePath, "file-copy-relative-path", (copy) => copy.commitFileContextMenu.relativePath, "copy selected historical file relative path"),
  context(HISTORY_COMMANDS.copyFileAbsolutePath, "file-copy-absolute-path", (copy) => copy.commitFileContextMenu.absolutePath, "copy selected historical file absolute path"),
  context(HISTORY_COMMANDS.copyFolderName, "folder-copy-name", (copy) => copy.commitFolderContextMenu.folderName, "copy focused historical folder name"),
  context(HISTORY_COMMANDS.copyFolderRelativePath, "folder-copy-relative-path", (copy) => copy.commitFolderContextMenu.relativePath, "copy focused historical folder relative path"),
  context(HISTORY_COMMANDS.copyFolderAbsolutePath, "folder-copy-absolute-path", (copy) => copy.commitFolderContextMenu.absolutePath, "copy focused historical folder absolute path"),
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
