import test from "node:test";
import assert from "node:assert/strict";
import {
  KEYBINDING_PROFILE_KEY,
  KeybindingStore,
  createSilentKeybindingSync,
  loadKeybindingProfile,
  setAddition,
  setReplacement,
} from "../src/features/keybindings/keybinding-store.ts";
import { primarySequence } from "../src/features/keybindings/keybinding-normalizer.ts";

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
}

test("shortcut profiles persist only versioned user overrides", () => {
  const storage = new MemoryStorage();
  const store = new KeybindingStore(storage, createSilentKeybindingSync());
  assert.equal(store.mutate((profile) => {
    setReplacement(profile, "workspace.quick-open.primary", "workspace.quickOpen.open", primarySequence("j"));
    setAddition(profile, { id: "alternate", commandId: "workspace.quickOpen.open", sequence: primarySequence("k") });
  }), true);
  const loaded = loadKeybindingProfile(storage);
  assert.equal(loaded.diagnostic, null);
  assert.equal(loaded.profile.version, 1);
  assert.equal(loaded.profile.revision, 1);
  assert.equal(loaded.profile.replacements[0].sequence[0].key, "j");
  assert.equal(loaded.profile.additions[0].id, "alternate");
  store.dispose();
});

test("invalid and oversized profiles fail closed without being overwritten", () => {
  const invalid = new MemoryStorage();
  invalid.setItem(KEYBINDING_PROFILE_KEY, "{broken");
  assert.equal(loadKeybindingProfile(invalid).diagnostic.kind, "invalid");
  assert.equal(invalid.getItem(KEYBINDING_PROFILE_KEY), "{broken");

  const oversized = new MemoryStorage();
  oversized.setItem(KEYBINDING_PROFILE_KEY, "x".repeat(256 * 1024 + 1));
  assert.equal(loadKeybindingProfile(oversized).diagnostic.kind, "oversized");

  const oversizedUnicode = new MemoryStorage();
  oversizedUnicode.setItem(KEYBINDING_PROFILE_KEY, "界".repeat(90 * 1024));
  assert.equal(loadKeybindingProfile(oversizedUnicode).diagnostic.kind, "oversized");
});

test("reset repairs an invalid persisted profile", () => {
  const storage = new MemoryStorage();
  storage.setItem(KEYBINDING_PROFILE_KEY, "{broken");
  const store = new KeybindingStore(storage, createSilentKeybindingSync());
  assert.equal(store.diagnostic.kind, "invalid");
  assert.equal(store.reset(), true);
  assert.equal(store.diagnostic, null);
  assert.equal(loadKeybindingProfile(storage).diagnostic, null);
  store.dispose();
});

test("reset removes additions and replacements while advancing the profile revision", () => {
  const storage = new MemoryStorage();
  const store = new KeybindingStore(storage, createSilentKeybindingSync());
  store.mutate((profile) => setReplacement(profile, "binding", "command", null));
  assert.equal(store.reset(), true);
  assert.equal(store.profile.replacements.length, 0);
  assert.equal(store.profile.additions.length, 0);
  assert.equal(store.profile.revision, 2);
  store.dispose();
});
