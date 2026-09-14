import {
  APP_PREFERENCES_KEY,
  loadAppPreferences,
  saveAppPreferences,
  updateAppPreferences,
  type AppPreferences,
} from "./preferences.ts";

export interface PreferenceSyncSignal {
  readonly sourceId: string;
  readonly schemaVersion: 7;
}

export interface PreferenceSyncPort {
  readonly sourceId: string;
  publish(signal: PreferenceSyncSignal): void;
  subscribe(listener: (signal: PreferenceSyncSignal) => void): () => void;
  dispose(): void;
}

export interface PreferenceStoreChange {
  readonly source: "local" | "external";
  readonly previous: AppPreferences;
  readonly preferences: AppPreferences;
}

type Listener = (change: PreferenceStoreChange) => void;

export class PreferenceStore {
  private readonly listeners = new Set<Listener>();
  private readonly releaseSync: () => void;
  private readonly storage: Storage;
  private readonly sync: PreferenceSyncPort;
  private disposed = false;
  private value: AppPreferences;

  constructor(
    storage: Storage,
    sync: PreferenceSyncPort,
  ) {
    this.storage = storage;
    this.sync = sync;
    this.value = loadAppPreferences(storage);
    this.releaseSync = sync.subscribe((signal) => {
      if (signal.sourceId === sync.sourceId) return;
      this.reload();
    });
  }

  get preferences(): AppPreferences {
    return this.value;
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(patch: Partial<AppPreferences>): boolean {
    if (this.disposed) return false;
    const next = updateAppPreferences(this.value, patch);
    if (samePreferences(this.value, next)) return false;
    const previous = this.value;
    saveAppPreferences(this.storage, next);
    this.value = next;
    this.emit({ source: "local", previous, preferences: next });
    this.sync.publish({ sourceId: this.sync.sourceId, schemaVersion: 7 });
    return true;
  }

  reload(): boolean {
    if (this.disposed) return false;
    const next = loadAppPreferences(this.storage);
    if (samePreferences(this.value, next)) return false;
    const previous = this.value;
    this.value = next;
    this.emit({ source: "external", previous, preferences: next });
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseSync();
    this.sync.dispose();
    this.listeners.clear();
  }

  private emit(change: PreferenceStoreChange): void {
    for (const listener of this.listeners) listener(change);
  }
}

export function createBrowserPreferenceSync(
  host: Window,
  channelName = "asterlyn.preferences",
): PreferenceSyncPort {
  const sourceId = createSourceId(host.crypto);
  const listeners = new Set<(signal: PreferenceSyncSignal) => void>();
  const channel = typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel(channelName);

  const notify = (signal: PreferenceSyncSignal) => {
    if (!isPreferenceSyncSignal(signal)) return;
    for (const listener of listeners) listener(signal);
  };
  const onMessage = (event: MessageEvent<unknown>) => notify(event.data as PreferenceSyncSignal);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== APP_PREFERENCES_KEY || event.storageArea !== host.localStorage) return;
    notify({ sourceId: "storage", schemaVersion: 7 });
  };
  channel?.addEventListener("message", onMessage);
  host.addEventListener("storage", onStorage);

  return {
    sourceId,
    publish: (signal) => channel?.postMessage(signal),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      listeners.clear();
      channel?.removeEventListener("message", onMessage);
      channel?.close();
      host.removeEventListener("storage", onStorage);
    },
  };
}

export function createSilentPreferenceSync(sourceId = "single-window"): PreferenceSyncPort {
  return {
    sourceId,
    publish: () => undefined,
    subscribe: () => () => undefined,
    dispose: () => undefined,
  };
}

function createSourceId(crypto: Crypto): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isPreferenceSyncSignal(value: unknown): value is PreferenceSyncSignal {
  return typeof value === "object" && value !== null &&
    "sourceId" in value && typeof value.sourceId === "string" &&
    "schemaVersion" in value && value.schemaVersion === 7;
}

function samePreferences(left: AppPreferences, right: AppPreferences): boolean {
  return (Object.keys(left) as Array<keyof AppPreferences>).every(
    (key) => left[key] === right[key],
  );
}
