import type {
  InstalledPlugin, PluginMarketplaceBridge, PluginSource, PluginSourceSnapshot,
} from "../../protocol/plugin-marketplace.ts";

let generation = 1;
let installationGeneration = 1;
let installedPlugins: InstalledPlugin[] = [];
let sources: PluginSource[] = [{
  repository: "guozhiqiang123/asterlyn-plugin-android-gradle",
  name: "Android",
  description: "Android project tasks, devices, deployment, and Run support.",
  builtIn: true,
  enabled: true,
  catalog: null,
}];

function snapshot(): PluginSourceSnapshot {
  return structuredClone({ schemaVersion: 1, generation, sources, recovered: false });
}

export const demoPluginMarketplaceBridge: PluginMarketplaceBridge = {
  async listPluginSources() { return snapshot(); },
  async upsertPluginSource(repository, name, description) {
    const normalized = repository.trim().replace(/^https:\/\/github\.com\//u, "").replace(/\.git\/?$/u, "").toLowerCase();
    const existing = sources.find((source) => source.repository === normalized);
    if (existing?.builtIn) throw new Error("The built-in source cannot be replaced.");
    sources = existing
      ? sources.map((source) => source.repository === normalized ? { ...source, name, description } : source)
      : [...sources, { repository: normalized, name, description, builtIn: false, enabled: true, catalog: null }];
    generation += 1;
    return snapshot();
  },
  async setPluginSourceEnabled(repository, enabled) {
    sources = sources.map((source) => source.repository === repository ? { ...source, enabled } : source);
    generation += 1;
    return snapshot();
  },
  async removePluginSource(repository) {
    sources = sources.filter((source) => source.repository !== repository || source.builtIn);
    generation += 1;
    return snapshot();
  },
  async refreshPluginSource(repository) {
    sources = sources.map((source) => source.repository === repository ? {
      ...source,
      catalog: {
        status: "available", checkedAtEpochMs: Date.now(), stale: false, version: "0.5.8",
        releaseUrl: `https://github.com/${repository}/releases/tag/v0.5.8`,
        assetName: "asterlyn-plugin-android-gradle-0.5.8.asterlyn-plugin.tgz", assetDownloadUrl: "https://github.com/guozhiqiang123/asterlyn-plugin-android-gradle/releases/download/v0.5.8/asterlyn-plugin-android-gradle-0.5.8.asterlyn-plugin.tgz", assetSizeBytes: 20_505,
        digest: "sha256:dfc945c1fe70ab633eeefb68a391513499991382e355b1efc7df0c6209bb4394", error: null, rateLimitResetEpochMs: null,
        etag: "demo-etag", lastModified: null,
      },
    } : source);
    generation += 1;
    return snapshot();
  },
  async listPluginInstallations() { return { schemaVersion: 1, generation: installationGeneration, plugins: structuredClone(installedPlugins), recovered: false }; },
  async listInstalledPluginManifests() { return { schemaVersion: 1, generation: installationGeneration, manifests: [] }; },
  async preparePluginInstall(repository) { return { reviewToken: "b".repeat(64), repository, sourceGeneration: generation, assetName: "asterlyn-plugin-android-gradle-0.5.8.asterlyn-plugin.tgz", assetSizeBytes: 20_505, digest: "sha256:dfc945c1fe70ab633eeefb68a391513499991382e355b1efc7df0c6209bb4394", pluginId: "dev.asterlyn.android-gradle", version: "0.5.8", licenseExpression: "MIT", capabilities: ["tasks"], permissions: ["host.tasks.discover"], hostOperations: ["adb.devices", "android.apk.inspect", "android.adb.install", "android.adb.uninstall", "android.adb.launch"], enabledAfterInstall: false, expandedBytes: 256_000 }; },
  async confirmPluginInstall() {
    installedPlugins = [{ pluginId: "dev.asterlyn.android-gradle", repository: "guozhiqiang123/asterlyn-plugin-android-gradle", enabled: true, bundledFallback: true, activeVersion: null, knownGoodVersion: null, pendingVersion: "0.5.8", versions: [{ version: "0.5.8", packageDigest: "sha256:dfc945c1fe70ab633eeefb68a391513499991382e355b1efc7df0c6209bb4394", contentDigest: `sha256:${"b".repeat(64)}`, admittedAtEpochMs: Date.now(), runtimeStatus: "pendingRestart" }] }];
    installationGeneration += 1;
    return { schemaVersion: 1, generation: installationGeneration, recovered: false, plugins: structuredClone(installedPlugins) };
  },
  async cancelPluginInstall() {},
  async restartForPluginChanges() {},
  async setInstalledPluginEnabled(pluginId, enabled) {
    installedPlugins = installedPlugins.map((plugin) => plugin.pluginId === pluginId ? { ...plugin, enabled } : plugin);
    installationGeneration += 1;
    return { schemaVersion: 1, generation: installationGeneration, recovered: false, plugins: structuredClone(installedPlugins) };
  },
  async selectInstalledPluginRollback(pluginId, version) {
    installedPlugins = installedPlugins.map((plugin) => plugin.pluginId === pluginId ? { ...plugin, pendingVersion: version } : plugin);
    installationGeneration += 1;
    return { schemaVersion: 1, generation: installationGeneration, recovered: false, plugins: structuredClone(installedPlugins) };
  },
  async uninstallInstalledPlugin(pluginId) {
    installedPlugins = installedPlugins.filter((plugin) => plugin.pluginId !== pluginId);
    installationGeneration += 1;
    return { schemaVersion: 1, generation: installationGeneration, recovered: false, plugins: structuredClone(installedPlugins) };
  },
};
