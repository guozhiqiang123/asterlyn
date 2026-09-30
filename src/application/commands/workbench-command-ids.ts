import { commandId } from "./command-service.ts";

export const WORKBENCH_COMMANDS = {
  commandPalette: commandId("workbench.commandPalette.open"),
  openRepository: commandId("workspace.repository.open"),
  quickOpen: commandId("workspace.quickOpen.open"),
  recentFiles: commandId("workspace.recentFiles.open"),
  workspaceSearch: commandId("workspace.search.open"),
  editorFind: commandId("editor.find.open"),
  historyFind: commandId("history.find.focus"),
  saveFile: commandId("editor.file.save"),
  refresh: commandId("workbench.refresh"),
  toggleFiles: commandId("workbench.tool.files.toggle"),
  toggleChanges: commandId("workbench.tool.changes.toggle"),
  toggleGit: commandId("workbench.tool.branches.toggle"),
  toggleTerminal: commandId("workbench.tool.terminal.toggle"),
} as const;
