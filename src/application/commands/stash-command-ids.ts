import { commandId } from "./command-service.ts";

export type StashCommandAction =
  | "refresh" | "toggle-view" | "expand-all" | "collapse-all"
  | "open-diff" | "apply" | "pop";

export const STASH_COMMANDS = {
  refresh: commandId("stash.refresh"),
  toggleFileView: commandId("stash.files.view.toggle"),
  expandAll: commandId("stash.files.expandAll"),
  collapseAll: commandId("stash.files.collapseAll"),
  openFileDiff: commandId("stash.file.diff.open"),
  apply: commandId("stash.selection.apply"),
  pop: commandId("stash.selection.pop"),
} as const;
