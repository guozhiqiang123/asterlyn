export const MANAGED_LANGUAGE_RECOMMENDATION_PREFERENCES_KEY =
  "asterlyn.managedLanguageRecommendations.v1";
export const MANAGED_LANGUAGE_RECOMMENDATION_PREFERENCE_LIMIT = 128;
const MAX_SERIALIZED_BYTES = 256 * 1024;
const SERIALIZED_ENCODER = new TextEncoder();

export interface ManagedLanguageRecommendationIdentity {
  readonly workspaceRoot: string;
  readonly pluginId: string;
  readonly languageId: string;
  readonly providerKey: string | null;
}

export interface ManagedLanguageRecommendationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StorageEventLike {
  readonly key: string | null;
  readonly newValue: string | null;
}

interface StorageEventTargetLike {
  addEventListener(type: "storage", listener: (event: StorageEventLike) => void): void;
  removeEventListener(type: "storage", listener: (event: StorageEventLike) => void): void;
}

type Listener = () => void;

/**
 * Project recommendation preferences are presentation-only. They are bounded,
 * never grant install or execution authority, and invalid storage suppresses nothing.
 */
export class ManagedLanguageRecommendationPreferences {
  private entries: ManagedLanguageRecommendationIdentity[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly storage?: ManagedLanguageRecommendationStorage;
  private readonly events?: StorageEventTargetLike;
  private readonly storageListener = (event: StorageEventLike): void => {
    if (event.key !== MANAGED_LANGUAGE_RECOMMENDATION_PREFERENCES_KEY) return;
    this.replace(parseEntries(event.newValue));
  };

  constructor(
    storage?: ManagedLanguageRecommendationStorage,
    events?: StorageEventTargetLike,
  ) {
    this.storage = storage;
    this.events = events;
    try {
      this.entries = parseEntries(
        storage?.getItem(MANAGED_LANGUAGE_RECOMMENDATION_PREFERENCES_KEY) ?? null,
      );
    } catch {
      this.entries = [];
    }
    events?.addEventListener("storage", this.storageListener);
  }

  isSuppressed(identity: ManagedLanguageRecommendationIdentity): boolean {
    return this.entries.some((entry) => sameIdentity(entry, identity));
  }

  suppress(identity: ManagedLanguageRecommendationIdentity): boolean {
    if (!validIdentity(identity) || this.isSuppressed(identity)) return false;
    this.entries.push(Object.freeze({ ...identity }));
    this.entries = this.entries.slice(-MANAGED_LANGUAGE_RECOMMENDATION_PREFERENCE_LIMIT);
    this.persist();
    this.emit();
    return true;
  }

  count(workspaceRoot: string | null, pluginId: string): number {
    if (workspaceRoot === null) return 0;
    return this.entries.filter(
      (entry) => entry.workspaceRoot === workspaceRoot && entry.pluginId === pluginId,
    ).length;
  }

  clear(workspaceRoot: string | null, pluginId: string): number {
    if (workspaceRoot === null) return 0;
    const previous = this.entries.length;
    this.entries = this.entries.filter(
      (entry) => entry.workspaceRoot !== workspaceRoot || entry.pluginId !== pluginId,
    );
    const removed = previous - this.entries.length;
    if (removed > 0) {
      this.persist();
      this.emit();
    }
    return removed;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.events?.removeEventListener("storage", this.storageListener);
    this.listeners.clear();
  }

  private replace(entries: ManagedLanguageRecommendationIdentity[]): void {
    if (sameEntries(this.entries, entries)) return;
    this.entries = entries;
    this.emit();
  }

  private persist(): void {
    try {
      let serialized = JSON.stringify({ version: 1, entries: this.entries });
      while (serializedBytes(serialized) > MAX_SERIALIZED_BYTES && this.entries.length > 0) {
        this.entries.shift();
        serialized = JSON.stringify({ version: 1, entries: this.entries });
      }
      this.storage?.setItem(
        MANAGED_LANGUAGE_RECOMMENDATION_PREFERENCES_KEY,
        serialized,
      );
    } catch {
      // The current-window preference remains useful when persistence is unavailable.
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export function managedLanguageRecommendationIdentityKey(
  identity: ManagedLanguageRecommendationIdentity,
): string {
  return JSON.stringify([
    identity.workspaceRoot,
    identity.pluginId,
    identity.languageId,
    identity.providerKey,
  ]);
}

function parseEntries(raw: string | null): ManagedLanguageRecommendationIdentity[] {
  if (!raw || serializedBytes(raw) > MAX_SERIALIZED_BYTES) return [];
  try {
    const value = JSON.parse(raw) as { version?: unknown; entries?: unknown };
    if (value.version !== 1 || !Array.isArray(value.entries) ||
      value.entries.length > MANAGED_LANGUAGE_RECOMMENDATION_PREFERENCE_LIMIT) return [];
    const entries: ManagedLanguageRecommendationIdentity[] = [];
    for (const candidate of value.entries) {
      if (!validIdentity(candidate)) return [];
      const entry = Object.freeze({ ...candidate });
      const duplicate = entries.findIndex((current) => sameIdentity(current, entry));
      if (duplicate >= 0) entries.splice(duplicate, 1);
      entries.push(entry);
    }
    return entries;
  } catch {
    return [];
  }
}

function validIdentity(value: unknown): value is ManagedLanguageRecommendationIdentity {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) =>
    !["workspaceRoot", "pluginId", "languageId", "providerKey"].includes(key))) return false;
  return typeof candidate.workspaceRoot === "string" &&
    candidate.workspaceRoot.length > 0 && candidate.workspaceRoot.length <= 16_384 &&
    !/[\u0000-\u001f\u007f]/u.test(candidate.workspaceRoot) &&
    typeof candidate.pluginId === "string" &&
    /^[a-z][a-z0-9.-]{0,159}$/u.test(candidate.pluginId) &&
    typeof candidate.languageId === "string" &&
    /^[a-z][a-z0-9-]{0,63}$/u.test(candidate.languageId) &&
    (candidate.providerKey === null || validProviderKey(candidate.providerKey, candidate.pluginId));
}

function validProviderKey(value: unknown, pluginId: unknown): value is string {
  if (typeof value !== "string" || value.length > 512 ||
    /[\u0000-\u001f\u007f]/u.test(value)) return false;
  try {
    const identity: unknown = JSON.parse(value);
    return Array.isArray(identity) && identity.length === 2 &&
      identity[0] === pluginId && typeof identity[1] === "string" &&
      /^[a-z][a-z0-9.-]{0,127}$/u.test(identity[1]);
  } catch {
    return false;
  }
}

function serializedBytes(value: string): number {
  return SERIALIZED_ENCODER.encode(value).length;
}

function sameIdentity(
  left: ManagedLanguageRecommendationIdentity,
  right: ManagedLanguageRecommendationIdentity,
): boolean {
  return left.workspaceRoot === right.workspaceRoot &&
    left.pluginId === right.pluginId &&
    left.languageId === right.languageId &&
    left.providerKey === right.providerKey;
}

function sameEntries(
  left: readonly ManagedLanguageRecommendationIdentity[],
  right: readonly ManagedLanguageRecommendationIdentity[],
): boolean {
  return left.length === right.length && left.every((entry, index) =>
    right[index] !== undefined && sameIdentity(entry, right[index]));
}
