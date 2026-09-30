import { commandId } from "./command-service.ts";

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
} as const;
