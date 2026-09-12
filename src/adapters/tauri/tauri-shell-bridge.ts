import type { OpenedProject } from "../../models.ts";
import type { DesktopShellBridge, DirectoryChoice } from "../../protocol/desktop-bridge.ts";
import { parseWindowChromeMode } from "../../workbench/window-chrome.ts";
import { invokeDesktopCommand, openDialog } from "./desktop-command-adapter.ts";

export const tauriShellBridge: DesktopShellBridge = {
  isDemo: false,
  async windowChromeMode() {
    return parseWindowChromeMode(await invokeDesktopCommand<unknown>("window_chrome_mode"));
  },
  initialRepository: () => invokeDesktopCommand<string | null>("initial_repository"),
  async chooseRepositoryDirectory(defaultPath): Promise<DirectoryChoice> {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Open Project Folder",
      defaultPath: defaultPath || undefined,
    });
    if (selected === null) return { kind: "cancelled" };
    if (Array.isArray(selected)) throw new Error("The folder chooser returned more than one path.");
    return { kind: "selected", path: selected };
  },
  openProject: (path) => invokeDesktopCommand<OpenedProject>("open_project", { path }),
  openRepositoryWindow: (path) =>
    invokeDesktopCommand<string>("open_repository_window", { path }),
};
