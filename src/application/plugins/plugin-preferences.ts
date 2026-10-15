import type {
  BundledPluginManifest,
  PluginSettingDescriptor,
  PluginSettingValue,
} from "./plugin-types.ts";

export const PLUGIN_PREFERENCES_KEY = "asterlyn.pluginPreferences.v1";
export const PLUGIN_PREFERENCES_VERSION = 1 as const;
export const PLUGIN_PREFERENCE_SYNC_VERSION = 1 as const;
const MAX_SERIALIZED_BYTES = 64 * 1024;
const MAX_PLUGINS = 32;
const MAX_SETTINGS_PER_PLUGIN = 32;
const MAX_TEXT = 256;

export interface PluginPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PluginPreferenceSyncSignal {
  readonly sourceId: string;
  readonly schemaVersion: typeof PLUGIN_PREFERENCE_SYNC_VERSION;
}

export interface PluginPreferenceSyncPort {
  readonly sourceId: string;
  publish(signal: PluginPreferenceSyncSignal): void;
  subscribe(listener: (signal: PluginPreferenceSyncSignal) => void): () => void;
  dispose(): void;
}

export interface PluginPreferenceSnapshot {
  readonly version: typeof PLUGIN_PREFERENCES_VERSION;
  readonly enabled: Readonly<Record<string, boolean>>;
  readonly settings: Readonly<Record<string, Readonly<Record<string, PluginSettingValue>>>>;
}

export interface PluginPreferenceChange {
  readonly source: "local" | "external";
  readonly previous: PluginPreferenceSnapshot;
  readonly preferences: PluginPreferenceSnapshot;
}

type Listener = (change: PluginPreferenceChange) => void;

/**
 * Host-owned, bounded preferences for bundled plugins. Unknown plugin and setting keys are
 * intentionally discarded during every load so stale profile data cannot become an API.
 */
export class PluginPreferenceStore {
  private readonly storage: PluginPreferenceStorage;
  private readonly sync: PluginPreferenceSyncPort;
  private readonly listeners = new Set<Listener>();
  private manifests = new Map<string, BundledPluginManifest>();
  private value: PluginPreferenceSnapshot;
  private disposed = false;
  private diagnosticsValue: readonly string[] = [];
  private readonly releaseSync: () => void;

  constructor(
    storage: PluginPreferenceStorage,
    manifests: readonly BundledPluginManifest[] = [],
    sync: PluginPreferenceSyncPort = createSilentPluginPreferenceSync(),
  ) {
    this.storage = storage;
    this.sync = sync;
    this.value = emptySnapshot();
    this.releaseSync = sync.subscribe((signal) => {
      if (signal.sourceId === sync.sourceId) return;
      this.reload();
    });
    this.setManifests(manifests, false);
  }

  get preferences(): PluginPreferenceSnapshot { return this.value; }
  get diagnostics(): readonly string[] { return this.diagnosticsValue; }

  setManifests(manifests: readonly BundledPluginManifest[], notify = true): boolean {
    const next = new Map<string, BundledPluginManifest>();
    for (const manifest of manifests.slice(0, MAX_PLUGINS)) {
      if (!validManifest(manifest) || next.has(manifest.id)) continue;
      next.set(manifest.id, manifest);
    }
    this.manifests = next;
    if (!notify) {
      const parsed = readStored(this.storage);
      this.diagnosticsValue = parsed.diagnostics;
      this.value = freezeState(normalizeState(parsed.value, this.manifests));
      return false;
    }
    return this.reload();
  }

  isEnabled(pluginId: string): boolean {
    return this.value.enabled[pluginId] ?? true;
  }

  setting(pluginId: string, settingId: string): PluginSettingValue | undefined {
    return this.value.settings[pluginId]?.[settingId];
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setEnabled(pluginId: string, enabled: boolean): boolean {
    if (this.disposed || !this.manifests.has(pluginId)) return false;
    if (this.isEnabled(pluginId) === enabled) return false;
    const next = cloneState(this.value);
    next.enabled[pluginId] = enabled;
    return this.commit(next);
  }

  setSetting(pluginId: string, settingId: string, value: PluginSettingValue): boolean {
    if (this.disposed) return false;
    const manifest = this.manifests.get(pluginId);
    const descriptor = manifest?.settings.find((setting) => setting.id === settingId);
    if (!descriptor || !validSettingValue(descriptor, value)) return false;
    const next = cloneState(this.value);
    (next.settings[pluginId] ??= {})[settingId] = value;
    return this.commit(next);
  }

  reload(): boolean {
    if (this.disposed) return false;
    const previous = this.value;
    const parsed = readStored(this.storage);
    this.diagnosticsValue = parsed.diagnostics;
    const next = normalizeState(parsed.value, this.manifests);
    if (sameState(previous, next)) return false;
    this.value = freezeState(next);
    this.emit({ source: "external", previous, preferences: this.value });
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseSync();
    this.sync.dispose();
    this.listeners.clear();
  }

  private commit(next: MutablePluginPreferenceSnapshot): boolean {
    const normalized = freezeState(normalizeState(next, this.manifests));
    if (sameState(this.value, normalized)) return false;
    const previous = this.value;
    try {
      const serialized = JSON.stringify(normalized);
      if (serialized.length > MAX_SERIALIZED_BYTES) {
        this.diagnosticsValue = ["plugin preference storage is too large"];
        return false;
      }
      this.storage.setItem(PLUGIN_PREFERENCES_KEY, serialized);
    } catch {
      this.diagnosticsValue = ["plugin preference storage is unavailable"];
      return false;
    }
    this.value = normalized;
    this.emit({ source: "local", previous, preferences: normalized });
    this.sync.publish({ sourceId: this.sync.sourceId, schemaVersion: PLUGIN_PREFERENCE_SYNC_VERSION });
    return true;
  }

  private emit(change: PluginPreferenceChange): void {
    for (const listener of this.listeners) listener(change);
  }
}

export function createBrowserPluginPreferenceStorage(host: Window = window): PluginPreferenceStorage {
  return host.localStorage;
}

export function createBrowserPluginPreferenceSync(
  host: Window,
  channelName = "asterlyn.pluginPreferences",
): PluginPreferenceSyncPort {
  const sourceId = typeof host.crypto?.randomUUID === "function"
    ? host.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const listeners = new Set<(signal: PluginPreferenceSyncSignal) => void>();
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(channelName);
  const notify = (value: unknown) => {
    if (!isSignal(value)) return;
    for (const listener of listeners) listener(value);
  };
  const onMessage = (event: MessageEvent<unknown>) => notify(event.data);
  const onStorage = (event: StorageEvent) => {
    if (event.key === PLUGIN_PREFERENCES_KEY && event.storageArea === host.localStorage) {
      notify({ sourceId: "storage", schemaVersion: PLUGIN_PREFERENCE_SYNC_VERSION });
    }
  };
  channel?.addEventListener("message", onMessage);
  host.addEventListener("storage", onStorage);
  return {
    sourceId,
    publish: (signal) => channel?.postMessage(signal),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() {
      listeners.clear();
      channel?.removeEventListener("message", onMessage);
      channel?.close();
      host.removeEventListener("storage", onStorage);
    },
  };
}

export function createSilentPluginPreferenceSync(sourceId = "single-window"): PluginPreferenceSyncPort {
  return { sourceId, publish: () => undefined, subscribe: () => () => undefined, dispose: () => undefined };
}

function emptySnapshot(): PluginPreferenceSnapshot {
  return Object.freeze({ version: PLUGIN_PREFERENCES_VERSION, enabled: Object.freeze({}), settings: Object.freeze({}) });
}

interface MutablePluginPreferenceSnapshot {
  version: typeof PLUGIN_PREFERENCES_VERSION;
  enabled: Record<string, boolean>;
  settings: Record<string, Record<string, PluginSettingValue>>;
}

function cloneState(value: PluginPreferenceSnapshot): MutablePluginPreferenceSnapshot {
  return {
    version: PLUGIN_PREFERENCES_VERSION,
    enabled: { ...value.enabled },
    settings: Object.fromEntries(Object.entries(value.settings).map(([id, settings]) => [id, { ...settings }])),
  };
}

function normalizeState(
  value: unknown,
  manifests: ReadonlyMap<string, BundledPluginManifest>,
): MutablePluginPreferenceSnapshot {
  const source = isRecord(value) ? value : {};
  const enabled: Record<string, boolean> = {};
  const settings: Record<string, Record<string, PluginSettingValue>> = {};
  for (const [id, manifest] of manifests) {
    enabled[id] = isRecord(source.enabled) && typeof source.enabled[id] === "boolean" ? source.enabled[id] : true;
    const sourceSettings = isRecord(source.settings) && isRecord(source.settings[id]) ? source.settings[id] : {};
    const target: Record<string, PluginSettingValue> = {};
    for (const descriptor of manifest.settings.slice(0, MAX_SETTINGS_PER_PLUGIN)) {
      const candidate = sourceSettings[descriptor.id];
      target[descriptor.id] = validSettingValue(descriptor, candidate)
        ? candidate
        : descriptor.defaultValue;
    }
    if (Object.keys(target).length > 0) settings[id] = target;
  }
  return { version: PLUGIN_PREFERENCES_VERSION, enabled, settings };
}

function readStored(storage: PluginPreferenceStorage): { value: unknown; diagnostics: readonly string[] } {
  let raw: string | null = null;
  try { raw = storage.getItem(PLUGIN_PREFERENCES_KEY); } catch { return { value: {}, diagnostics: ["plugin preference storage is unavailable"] }; }
  if (!raw) return { value: {}, diagnostics: [] };
  if (raw.length > MAX_SERIALIZED_BYTES) return { value: {}, diagnostics: ["plugin preference storage is too large"] };
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== PLUGIN_PREFERENCES_VERSION) {
      return { value: {}, diagnostics: ["plugin preference schema is unsupported"] };
    }
    return { value, diagnostics: [] };
  } catch {
    return { value: {}, diagnostics: ["plugin preference storage is corrupted"] };
  }
}

function validManifest(value: BundledPluginManifest): boolean {
  return isRecord(value) && validText(value.id) && validText(value.version) &&
    validText(value.nameKey) && validText(value.descriptionKey) && Array.isArray(value.settings);
}

function validSettingValue(descriptor: PluginSettingDescriptor, value: unknown): value is PluginSettingValue {
  if (descriptor.kind === "boolean") return typeof value === "boolean";
  return typeof value === "string" && descriptor.options?.some((option) => option.value === value) === true;
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT && !value.includes("\0");
}

function freezeState(value: MutablePluginPreferenceSnapshot): PluginPreferenceSnapshot {
  for (const settings of Object.values(value.settings)) Object.freeze(settings);
  Object.freeze(value.enabled);
  Object.freeze(value.settings);
  return Object.freeze(value);
}

function sameState(left: PluginPreferenceSnapshot, right: PluginPreferenceSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSignal(value: unknown): value is PluginPreferenceSyncSignal {
  return isRecord(value) && typeof value.sourceId === "string" && value.schemaVersion === PLUGIN_PREFERENCE_SYNC_VERSION;
}
