import type { DesktopBridge } from "../../protocol/desktop-bridge.ts";
import { tauriAppUpdateBridge } from "./tauri-app-update-bridge.ts";
import { tauriGitOperationBridge } from "./tauri-git-operation-bridge.ts";
import { tauriGitReadBridge } from "./tauri-git-read-bridge.ts";
import { tauriShellBridge } from "./tauri-shell-bridge.ts";
import { tauriTerminalBridge } from "./tauri-terminal-bridge.ts";
import { tauriWorkspaceBridge } from "./tauri-workspace-bridge.ts";
import { tauriTaskExecutionBridge } from "./tauri-task-execution-bridge.ts";
import { tauriTaskArtifactBridge } from "./tauri-task-artifact-bridge.ts";
import { tauriPluginTaskCacheBridge } from "./tauri-plugin-task-cache-bridge.ts";

export const tauriDesktopBridge: DesktopBridge = {
  ...tauriAppUpdateBridge,
  ...tauriShellBridge,
  ...tauriWorkspaceBridge,
  ...tauriGitReadBridge,
  ...tauriGitOperationBridge,
  ...tauriTerminalBridge,
  ...tauriTaskExecutionBridge,
  ...tauriTaskArtifactBridge,
  ...tauriPluginTaskCacheBridge,
  executePluginProcessQuery: (...args) => import("./tauri-plugin-process-query-bridge.ts")
    .then(({ tauriPluginProcessQueryBridge }) => tauriPluginProcessQueryBridge.executePluginProcessQuery(...args)),
};
