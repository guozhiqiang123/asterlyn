import { isTauriRuntime } from "./adapters/tauri/desktop-command-adapter.ts";
import { tauriWorkspaceWatchBridge } from "./adapters/tauri/tauri-workspace-watch-bridge.ts";
import type { WorkspaceWatchBridge } from "./protocol/workspace-watch.ts";

const inactiveWorkspaceWatchBridge: WorkspaceWatchBridge = {
  native: false,
  async start() {
    return { available: false, message: null };
  },
  async stop() {},
  async subscribe() {
    return () => undefined;
  },
};

export const workspaceWatchBridge = isTauriRuntime
  ? tauriWorkspaceWatchBridge
  : inactiveWorkspaceWatchBridge;
