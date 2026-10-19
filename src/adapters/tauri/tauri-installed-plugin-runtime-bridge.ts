import type {
  InstalledPluginActivation,
  InstalledPluginRuntimeBridge,
  InstalledPluginRuntimeDiagnostics,
  InstalledPluginRuntimeEvent,
  PluginRuntimeTheme,
  PluginRuntimeValue,
} from "../../protocol/plugin-runtime.ts";
import {
  PLUGIN_RUNTIME_EVENT,
  parseInstalledPluginRuntimeEvent,
} from "../../protocol/plugin-runtime.ts";
import { invokeDesktopCommand as invoke } from "./desktop-command-adapter.ts";

export const tauriInstalledPluginRuntimeBridge: InstalledPluginRuntimeBridge = {
  activate: (
    pluginId: string,
    workspaceRoot: string,
    workspaceGeneration: number,
    evidence: PluginRuntimeValue,
    locale: string,
    theme: PluginRuntimeTheme,
  ) => invoke<InstalledPluginActivation>("activate_installed_plugin_runtime", {
    pluginId,
    workspaceRoot,
    workspaceGeneration,
    evidence,
    locale,
    theme,
  }),
  invoke: (
    pluginId: string,
    callbackHandle: string,
    operation: string,
    payload: PluginRuntimeValue,
  ) => invoke<PluginRuntimeValue>("invoke_installed_plugin_callback", {
    pluginId,
    callbackHandle,
    operation,
    payload,
  }),
  deactivate: (pluginId: string) => invoke<void>("deactivate_installed_plugin_runtime", {
    pluginId,
  }),
  diagnostics: (pluginId: string) => invoke<InstalledPluginRuntimeDiagnostics>(
    "read_installed_plugin_runtime_diagnostics",
    { pluginId },
  ),
  async subscribe(listener: (event: InstalledPluginRuntimeEvent) => void) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<unknown>(PLUGIN_RUNTIME_EVENT, (event) => {
      listener(parseInstalledPluginRuntimeEvent(event.payload));
    });
  },
};
