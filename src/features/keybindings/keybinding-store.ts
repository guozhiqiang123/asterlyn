import {
  EMPTY_KEYBINDING_PROFILE,
  type AddedKeybinding,
  type KeySequence,
  type KeyStroke,
  type KeybindingProfileV1,
  type KeybindingReplacement,
} from "./keybinding-model.ts";

export const KEYBINDING_PROFILE_KEY = "asterlyn.keybindings.v1";
const MAX_SERIALIZED_BYTES = 256 * 1024;
const MAX_OVERRIDES = 2_048;
const MAX_ID_LENGTH = 160;

export interface KeybindingProfileDiagnostic {
  readonly kind: "invalid" | "oversized";
}

export interface KeybindingStoreChange {
  readonly source: "local" | "external";
  readonly profile: KeybindingProfileV1;
  readonly diagnostic: KeybindingProfileDiagnostic | null;
}

export interface KeybindingSyncSignal {
  readonly sourceId: string;
  readonly schemaVersion: 1;
}

export interface KeybindingSyncPort {
  readonly sourceId: string;
  publish(signal: KeybindingSyncSignal): void;
  subscribe(listener: (signal: KeybindingSyncSignal) => void): () => void;
  dispose(): void;
}

type Listener = (change: KeybindingStoreChange) => void;

export class KeybindingStore {
  private readonly listeners = new Set<Listener>();
  private readonly releaseSync: () => void;
  private value: KeybindingProfileV1;
  private diagnosticValue: KeybindingProfileDiagnostic | null;
  private disposed = false;
  private readonly storage: Storage;
  private readonly sync: KeybindingSyncPort;

  constructor(
    storage: Storage,
    sync: KeybindingSyncPort = createSilentKeybindingSync(),
  ) {
    this.storage = storage;
    this.sync = sync;
    const loaded = loadKeybindingProfile(storage);
    this.value = loaded.profile;
    this.diagnosticValue = loaded.diagnostic;
    this.releaseSync = sync.subscribe((signal) => {
      if (signal.sourceId !== sync.sourceId) this.reload();
    });
  }

  get profile(): KeybindingProfileV1 {
    return this.value;
  }

  get diagnostic(): KeybindingProfileDiagnostic | null {
    return this.diagnosticValue;
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  mutate(
    mutation: (profile: MutableKeybindingProfile) => void,
  ): boolean {
    if (this.disposed) return false;
    const latest = loadKeybindingProfile(this.storage);
    const base = latest.diagnostic ? this.value : latest.profile;
    const mutable = mutableProfile(base);
    mutation(mutable);
    const next = normalizeMutableProfile(mutable, base.revision + 1);
    if (sameProfile(this.value, next) && !this.diagnosticValue) return false;
    saveKeybindingProfile(this.storage, next);
    this.value = next;
    this.diagnosticValue = null;
    this.emit("local");
    this.sync.publish({ sourceId: this.sync.sourceId, schemaVersion: 1 });
    return true;
  }

  reset(): boolean {
    return this.mutate((profile) => {
      profile.replacements = [];
      profile.additions = [];
    });
  }

  reload(): boolean {
    if (this.disposed) return false;
    const loaded = loadKeybindingProfile(this.storage);
    if (
      sameProfile(this.value, loaded.profile) &&
      this.diagnosticValue?.kind === loaded.diagnostic?.kind
    ) return false;
    this.value = loaded.profile;
    this.diagnosticValue = loaded.diagnostic;
    this.emit("external");
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseSync();
    this.sync.dispose();
    this.listeners.clear();
  }

  private emit(source: "local" | "external"): void {
    const change = {
      source,
      profile: this.value,
      diagnostic: this.diagnosticValue,
    } satisfies KeybindingStoreChange;
    for (const listener of this.listeners) listener(change);
  }
}

export interface MutableKeybindingProfile {
  replacements: KeybindingReplacement[];
  additions: AddedKeybinding[];
}

export function setReplacement(
  profile: MutableKeybindingProfile,
  bindingId: string,
  commandId: string,
  sequence: KeySequence | null,
): void {
  profile.replacements = profile.replacements.filter((entry) => entry.bindingId !== bindingId);
  profile.replacements.push({ bindingId, commandId, sequence });
}

export function removeReplacement(
  profile: MutableKeybindingProfile,
  bindingId: string,
): void {
  profile.replacements = profile.replacements.filter((entry) => entry.bindingId !== bindingId);
}

export function setAddition(
  profile: MutableKeybindingProfile,
  addition: AddedKeybinding,
): void {
  profile.additions = profile.additions.filter((entry) => entry.id !== addition.id);
  profile.additions.push(addition);
}

export function removeAddition(profile: MutableKeybindingProfile, id: string): void {
  profile.additions = profile.additions.filter((entry) => entry.id !== id);
}

export function createKeybindingAdditionId(cryptoValue: Crypto = crypto): string {
  return typeof cryptoValue.randomUUID === "function"
    ? cryptoValue.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function loadKeybindingProfile(
  storage: Pick<Storage, "getItem">,
): {
  readonly profile: KeybindingProfileV1;
  readonly diagnostic: KeybindingProfileDiagnostic | null;
} {
  try {
    const raw = storage.getItem(KEYBINDING_PROFILE_KEY);
    if (!raw) return { profile: EMPTY_KEYBINDING_PROFILE, diagnostic: null };
    if (serializedByteLength(raw) > MAX_SERIALIZED_BYTES) {
      return { profile: EMPTY_KEYBINDING_PROFILE, diagnostic: { kind: "oversized" } };
    }
    const profile = parseProfile(JSON.parse(raw));
    return profile
      ? { profile, diagnostic: null }
      : { profile: EMPTY_KEYBINDING_PROFILE, diagnostic: { kind: "invalid" } };
  } catch {
    return { profile: EMPTY_KEYBINDING_PROFILE, diagnostic: { kind: "invalid" } };
  }
}

export function saveKeybindingProfile(
  storage: Pick<Storage, "setItem">,
  profile: KeybindingProfileV1,
): void {
  const serialized = JSON.stringify(profile);
  if (serializedByteLength(serialized) > MAX_SERIALIZED_BYTES) {
    throw new Error("Keyboard shortcut profile exceeds its storage limit.");
  }
  storage.setItem(KEYBINDING_PROFILE_KEY, serialized);
}

export function createBrowserKeybindingSync(
  host: Window,
  channelName = "asterlyn.keybindings",
): KeybindingSyncPort {
  const sourceId = typeof host.crypto.randomUUID === "function"
    ? host.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const listeners = new Set<(signal: KeybindingSyncSignal) => void>();
  const channel = typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel(channelName);
  const notify = (value: unknown) => {
    if (!isSyncSignal(value)) return;
    for (const listener of listeners) listener(value);
  };
  const onMessage = (event: MessageEvent<unknown>) => notify(event.data);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEYBINDING_PROFILE_KEY || event.storageArea !== host.localStorage) return;
    notify({ sourceId: "storage", schemaVersion: 1 });
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

export function createSilentKeybindingSync(sourceId = "single-window"): KeybindingSyncPort {
  return {
    sourceId,
    publish: () => undefined,
    subscribe: () => () => undefined,
    dispose: () => undefined,
  };
}

function parseProfile(value: unknown): KeybindingProfileV1 | null {
  if (!isRecord(value) || value.version !== 1 || !Number.isSafeInteger(value.revision)) return null;
  if (!Array.isArray(value.replacements) || !Array.isArray(value.additions)) return null;
  if (value.replacements.length + value.additions.length > MAX_OVERRIDES) return null;
  const replacements: KeybindingReplacement[] = [];
  const additions: AddedKeybinding[] = [];
  const replacementIds = new Set<string>();
  const additionIds = new Set<string>();
  for (const candidate of value.replacements) {
    if (
      !isRecord(candidate) || !safeId(candidate.bindingId) || !safeId(candidate.commandId) ||
      (candidate.sequence !== null && !isSequence(candidate.sequence)) ||
      replacementIds.has(candidate.bindingId)
    ) return null;
    replacementIds.add(candidate.bindingId);
    replacements.push({
      bindingId: candidate.bindingId,
      commandId: candidate.commandId,
      sequence: candidate.sequence,
    });
  }
  for (const candidate of value.additions) {
    if (
      !isRecord(candidate) || !safeId(candidate.id) || !safeId(candidate.commandId) ||
      !isSequence(candidate.sequence) || additionIds.has(candidate.id)
    ) return null;
    additionIds.add(candidate.id);
    additions.push({ id: candidate.id, commandId: candidate.commandId, sequence: candidate.sequence });
  }
  return {
    version: 1,
    revision: Math.max(0, value.revision as number),
    replacements,
    additions,
  };
}

function isSequence(value: unknown): value is KeySequence {
  return Array.isArray(value) && (value.length === 1 || value.length === 2) && value.every(isStroke);
}

function isStroke(value: unknown): value is KeyStroke {
  return isRecord(value) && safeKey(value.key) &&
    typeof value.primary === "boolean" && typeof value.control === "boolean" &&
    typeof value.alt === "boolean" && typeof value.shift === "boolean" &&
    typeof value.meta === "boolean";
}

function safeId(value: unknown, length = MAX_ID_LENGTH): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= length;
}

function safeKey(value: unknown): value is string {
  return safeId(value, 40) && !/[\u0000-\u001f\u007f]/u.test(value);
}

function serializedByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mutableProfile(profile: KeybindingProfileV1): MutableKeybindingProfile {
  return {
    replacements: structuredClone(profile.replacements) as KeybindingReplacement[],
    additions: structuredClone(profile.additions) as AddedKeybinding[],
  };
}

function normalizeMutableProfile(
  profile: MutableKeybindingProfile,
  revision: number,
): KeybindingProfileV1 {
  return {
    version: 1,
    revision,
    replacements: profile.replacements.slice(0, MAX_OVERRIDES),
    additions: profile.additions.slice(0, Math.max(0, MAX_OVERRIDES - profile.replacements.length)),
  };
}

function sameProfile(left: KeybindingProfileV1, right: KeybindingProfileV1): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isSyncSignal(value: unknown): value is KeybindingSyncSignal {
  return isRecord(value) && typeof value.sourceId === "string" && value.schemaVersion === 1;
}
