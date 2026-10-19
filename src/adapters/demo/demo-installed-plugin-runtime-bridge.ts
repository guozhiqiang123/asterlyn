import type { InstalledPluginRuntimeBridge } from "../../protocol/plugin-runtime.ts";

function unavailable(): never {
  throw new Error("Installed plugin runtimes are unavailable in browser demo mode.");
}

export const demoInstalledPluginRuntimeBridge: InstalledPluginRuntimeBridge = {
  activate: async () => unavailable(),
  invoke: async () => unavailable(),
  deactivate: async () => undefined,
  diagnostics: async () => unavailable(),
  subscribe: async () => () => undefined,
  subscribeNotifications: async () => () => undefined,
};
