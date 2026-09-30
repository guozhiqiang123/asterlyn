import { commandId } from "./command-service.ts";

export type StashCommandAction =
  | "refresh" | "toggle-view" | "expand-all" | "collapse-all"
  | "open-diff" | "open-diff-new-tab" | "apply" | "pop" | "unstash" | "drop" | "clear";

export const STASH_COMMANDS = {
  refresh: commandId("stash.refresh"),
  toggleFileView: commandId("stash.files.view.toggle"),
  expandAll: commandId("stash.files.expandAll"),
  collapseAll: commandId("stash.files.collapseAll"),
  openFileDiff: commandId("stash.file.diff.open"),
  openFileDiffNewTab: commandId("stash.file.diff.openNewTab"),
  apply: commandId("stash.selection.apply"),
  pop: commandId("stash.selection.pop"),
  unstash: commandId("stash.selection.unstash"),
  drop: commandId("stash.selection.drop"),
  clear: commandId("stash.clear"),
} as const;
