import type { PluginMarketplaceBridge, PluginSourceSnapshot } from "../../protocol/plugin-marketplace.ts";
import { invokeDesktopCommand as invoke } from "./desktop-command-adapter.ts";

export const tauriPluginMarketplaceBridge: PluginMarketplaceBridge = {
  listPluginSources: () => invoke<PluginSourceSnapshot>("list_plugin_sources"),
  upsertPluginSource: (repository, name, description) => invoke<PluginSourceSnapshot>("upsert_plugin_source", {
    repository, name, description,
  }),
  setPluginSourceEnabled: (repository, enabled) => invoke<PluginSourceSnapshot>("set_plugin_source_enabled", {
    repository, enabled,
  }),
  removePluginSource: (repository) => invoke<PluginSourceSnapshot>("remove_plugin_source", { repository }),
  refreshPluginSource: (repository) => invoke<PluginSourceSnapshot>("refresh_plugin_source", { repository }),
};
