import type { DesktopBridge } from "../../protocol/desktop-bridge.ts";
import { tauriGitOperationBridge } from "./tauri-git-operation-bridge.ts";
import { tauriGitReadBridge } from "./tauri-git-read-bridge.ts";
import { tauriShellBridge } from "./tauri-shell-bridge.ts";
import { tauriWorkspaceBridge } from "./tauri-workspace-bridge.ts";

export const tauriDesktopBridge: DesktopBridge = {
  ...tauriShellBridge,
  ...tauriWorkspaceBridge,
  ...tauriGitReadBridge,
  ...tauriGitOperationBridge,
};
