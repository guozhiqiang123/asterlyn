import type { SystemFileClipboardEntry, SystemFileClipboardImportResult } from "../../models.ts";
import type { WorkspaceBridge } from "../../protocol/desktop-bridge.ts";
import { invokeDesktopCommand, isTauriRuntime } from "../tauri/desktop-command-adapter.ts";

type SystemFileClipboardBridge = Pick<
  WorkspaceBridge,
  | "copyWorkspaceEntryToSystemClipboard"
  | "readSystemFileClipboardEntry"
  | "importSystemFileClipboardEntry"
>;

export const demoSystemFileClipboardBridge: SystemFileClipboardBridge = {
  copyWorkspaceEntryToSystemClipboard: (repositoryRoot, workspacePath, kind) => {
    if (!isTauriRuntime) {
      return Promise.reject(new Error("The system file clipboard requires the desktop build."));
    }
    return invokeDesktopCommand<SystemFileClipboardEntry>(
      "copy_workspace_entry_to_system_clipboard",
      { repositoryRoot, workspacePath, kind },
    );
  },
  readSystemFileClipboardEntry: () => isTauriRuntime
    ? invokeDesktopCommand<SystemFileClipboardEntry | null>(
        "read_system_file_clipboard_entry",
        {},
      )
    : Promise.resolve(null),
  importSystemFileClipboardEntry: (repositoryRoot, clipboardToken, destination) => {
    if (!isTauriRuntime) {
      return Promise.reject(new Error("The system file clipboard requires the desktop build."));
    }
    return invokeDesktopCommand<SystemFileClipboardImportResult>(
      "import_system_file_clipboard_entry",
      { repositoryRoot, clipboardToken, destination },
    );
  },
};
