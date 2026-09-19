import { isTauriRuntime } from "./adapters/tauri/desktop-command-adapter.ts";
import { tauriDesktopBridge } from "./adapters/tauri/tauri-desktop-bridge.ts";
import type { DesktopBridge } from "./protocol/desktop-bridge.ts";

export const bridge: DesktopBridge = isTauriRuntime
  ? tauriDesktopBridge
  : (await import("./adapters/demo/demo-desktop-bridge.ts")).demoDesktopBridge;

export type { DirectoryChoice } from "./protocol/desktop-bridge.ts";
