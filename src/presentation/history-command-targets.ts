import type { CommandFocusScope, CommandId } from "../application/commands/command-service.ts";
import { HISTORY_COMMANDS } from "../application/commands/history-command-ids.ts";
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
