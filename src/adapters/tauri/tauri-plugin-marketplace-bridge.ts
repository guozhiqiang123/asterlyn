import type { InstalledPluginManifestSnapshot, PluginInstallationSnapshot, PluginMarketplaceBridge, PluginPackageAdmissionReview, PluginSourceSnapshot } from "../../protocol/plugin-marketplace.ts";
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
  listPluginInstallations: () => invoke<PluginInstallationSnapshot>("list_plugin_installations"),
  listInstalledPluginManifests: () => invoke<InstalledPluginManifestSnapshot>("list_installed_plugin_manifests"),
  preparePluginInstall: (repository) => invoke<PluginPackageAdmissionReview>("prepare_plugin_install", { repository }),
  confirmPluginInstall: (reviewToken) => invoke<PluginInstallationSnapshot>("confirm_plugin_install", { reviewToken }),
  cancelPluginInstall: (reviewToken) => invoke<void>("cancel_plugin_install", { reviewToken }),
  restartForPluginChanges: () => invoke<void>("restart_for_plugin_changes"),
  setInstalledPluginEnabled: (pluginId, enabled) => invoke<PluginInstallationSnapshot>("set_installed_plugin_enabled", { pluginId, enabled }),
  selectInstalledPluginRollback: (pluginId, version, packageDigest) => invoke<PluginInstallationSnapshot>("select_installed_plugin_rollback", { pluginId, version, packageDigest }),
  uninstallInstalledPlugin: (pluginId) => invoke<PluginInstallationSnapshot>("uninstall_installed_plugin", { pluginId }),
};
