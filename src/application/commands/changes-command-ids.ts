import { commandId } from "./command-service.ts";

export const CHANGES_COMMANDS = {
  refresh: commandId("changes.refresh"),
  toggleIncluded: commandId("changes.selection.include.toggle"),
  openDiff: commandId("changes.selection.diff.open"),
  openSource: commandId("changes.selection.source.open"),
  restore: commandId("changes.selection.restore"),
  trash: commandId("changes.selection.trash"),
  resolveConflict: commandId("changes.selection.conflict.resolve"),
  showHistory: commandId("changes.selection.history"),
  copyName: commandId("changes.selection.copyName"),
  copyRelativePath: commandId("changes.selection.copyRelativePath"),
  copyAbsolutePath: commandId("changes.selection.copyAbsolutePath"),
  toggleView: commandId("changes.view.toggle"),
  expandAll: commandId("changes.folders.expandAll"),
  collapseAll: commandId("changes.folders.collapseAll"),
  stageAllUnversioned: commandId("changes.unversioned.stageAll"),
  trashAllUnversioned: commandId("changes.unversioned.trashAll"),
  commit: commandId("changes.commit.create"),
  stash: commandId("changes.stash.create"),
} as const;
