import type {
  BundledPlugin,
  PluginActivationReport,
  PluginDiagnostic,
  PluginManagementEntry,
  PluginManagementSnapshot,
} from "./plugin-types.ts";
import type { PluginPreferenceStore } from "./plugin-preferences.ts";

type Listener = (snapshot: PluginManagementSnapshot) => void;

/** Publishes host-owned plugin state without exposing activation internals to Settings. */
export class PluginManagementRuntime {
  private readonly preferences: PluginPreferenceStore;
  private readonly listeners = new Set<Listener>();
  private plugins: readonly BundledPlugin[] = [];
  private matched = new Set<string>();
  private active = new Set<string>();
  private diagnostics = new Map<string, readonly PluginDiagnostic[]>();
  private value: PluginManagementSnapshot = { schemaVersion: 1, entries: [] };
  private disposed = false;
  private readonly releasePreferences: () => void;

  constructor(preferences: PluginPreferenceStore) {
    this.preferences = preferences;
    this.releasePreferences = preferences.subscribe(() => this.publish());
  }

  get snapshot(): PluginManagementSnapshot { return this.value; }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setCatalog(plugins: readonly BundledPlugin[]): void {
    this.plugins = [...plugins];
    this.publish();
  }

  setMatched(ids: Iterable<string>): void {
    this.matched = new Set(ids);
    this.publish();
  }

  setActivation(report: PluginActivationReport | null): void {
    this.active = new Set(report?.activated ?? []);
    this.diagnostics = new Map<string, readonly PluginDiagnostic[]>(
      this.plugins.map((plugin) => [plugin.id, []]),
    );
    if (report) {
      for (const diagnostic of report.diagnostics) {
        const current = this.diagnostics.get(diagnostic.pluginId) ?? [];
        this.diagnostics.set(diagnostic.pluginId, [...current, diagnostic]);
      }
    }
    this.publish();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releasePreferences();
    this.listeners.clear();
  }

  private publish(): void {
    if (this.disposed) return;
    const preferences = this.preferences.preferences;
    const entries: PluginManagementEntry[] = this.plugins.map((plugin) => Object.freeze({
      id: plugin.id,
      version: plugin.version,
      nameKey: plugin.manifest.nameKey,
      descriptionKey: plugin.manifest.descriptionKey,
      localization: plugin.manifest.localization,
      enabled: preferences.enabled[plugin.id] ?? true,
      matched: this.matched.has(plugin.id),
      active: this.active.has(plugin.id),
      settingDescriptors: plugin.manifest.settings,
      settings: Object.freeze({ ...(preferences.settings[plugin.id] ?? {}) }),
      ...(plugin.manifest.taskAuthorization === undefined
        ? {}
        : { taskAuthorization: plugin.manifest.taskAuthorization }),
      diagnostics: Object.freeze([...(this.diagnostics.get(plugin.id) ?? [])]),
    }));
    this.value = Object.freeze({ schemaVersion: 1, entries: Object.freeze(entries) });
    for (const listener of this.listeners) listener(this.value);
  }
}
