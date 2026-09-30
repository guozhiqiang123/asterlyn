import { commandId } from "./command-service.ts";

export type RemoteCommandAction =
  | "open-update" | "open-push" | "cancel-operation" | "manage"
  | "open-file-diff" | "open-current-file" | "toggle-file-view"
  | "expand-folders" | "collapse-folders" | "load-more";

export const REMOTE_COMMANDS = {
  openUpdate: commandId("remote.update.open"),
  openPush: commandId("remote.push.open"),
  cancelOperation: commandId("remote.operation.cancel"),
  manage: commandId("remote.manage.open"),
  openFileDiff: commandId("remote.push.file.diff"),
  openCurrentFile: commandId("remote.push.file.openCurrent"),
  toggleFileView: commandId("remote.push.files.view.toggle"),
  expandFolders: commandId("remote.push.files.expandAll"),
  collapseFolders: commandId("remote.push.files.collapseAll"),
  loadMore: commandId("remote.push.loadMore"),
} as const;
