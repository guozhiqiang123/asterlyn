import { commandId } from "./command-service.ts";

export const FILES_COMMANDS = {
  locateActive: commandId("files.active.locate"),
  expandFolder: commandId("files.folder.expand"),
  collapseFolder: commandId("files.folder.collapse"),
  openSelection: commandId("files.selection.open"),
  createFile: commandId("files.file.create"),
  renameSelection: commandId("files.selection.rename"),
  cutSelection: commandId("files.selection.cut"),
  copySelection: commandId("files.selection.copy"),
  pasteSelection: commandId("files.selection.paste"),
  revealSelection: commandId("files.selection.reveal"),
  copyName: commandId("files.selection.copyName"),
  copyRelativePath: commandId("files.selection.copyRelativePath"),
  copyAbsolutePath: commandId("files.selection.copyAbsolutePath"),
  selectionHistory: commandId("files.selection.history"),
  trashSelection: commandId("files.selection.trash"),
  openRecoveries: commandId("files.recovery.open"),
  refresh: commandId("files.refresh"),
} as const;

export const EDITOR_COMMANDS = {
  closeTab: commandId("editor.tab.close"),
  previousTab: commandId("editor.tab.previous"),
  nextTab: commandId("editor.tab.next"),
  toggleTabList: commandId("editor.tabList.toggle"),
  markdownSource: commandId("editor.markdown.source"),
  markdownSplit: commandId("editor.markdown.split"),
  markdownPreview: commandId("editor.markdown.preview"),
} as const;

export const DIFF_COMMANDS = {
  previousChange: commandId("diff.change.previous"),
  nextChange: commandId("diff.change.next"),
  previousFile: commandId("diff.file.previous"),
  nextFile: commandId("diff.file.next"),
  openSource: commandId("diff.source.open"),
  toggleUnchanged: commandId("diff.unchanged.toggle"),
  unified: commandId("diff.layout.unified"),
  split: commandId("diff.layout.split"),
  toggleWhitespace: commandId("diff.whitespace.toggle"),
} as const;
