import assert from "node:assert/strict";
import test from "node:test";
import {
  MANAGED_LANGUAGE_RECOMMENDATION_PREFERENCES_KEY,
  ManagedLanguageRecommendationPreferences,
} from "../src/application/language-services/recommendation-preferences.ts";

class MemoryStorage {
  value = null;
  getItem(key) {
    return key === MANAGED_LANGUAGE_RECOMMENDATION_PREFERENCES_KEY ? this.value : null;
  }
  setItem(key, value) {
    if (key === MANAGED_LANGUAGE_RECOMMENDATION_PREFERENCES_KEY) this.value = value;
  }
}

class StorageEvents {
  listeners = new Set();
  addEventListener(_type, listener) { this.listeners.add(listener); }
  removeEventListener(_type, listener) { this.listeners.delete(listener); }
  emit(newValue) {
    for (const listener of this.listeners) listener({
      key: MANAGED_LANGUAGE_RECOMMENDATION_PREFERENCES_KEY,
      newValue,
    });
  }
}

const identity = (workspaceRoot = "/repo", languageId = "rust") => ({
  workspaceRoot,
  pluginId: "dev.asterlyn.lsp",
  languageId,
  providerKey: null,
});

test("project recommendation suppression persists, deduplicates and remains reversible", () => {
  const storage = new MemoryStorage();
  const preferences = new ManagedLanguageRecommendationPreferences(storage);
  let changes = 0;
  preferences.subscribe(() => { changes += 1; });
  assert.equal(preferences.suppress(identity()), true);
  assert.equal(preferences.suppress(identity()), false);
  assert.equal(preferences.isSuppressed(identity()), true);
  assert.equal(preferences.count("/repo", "dev.asterlyn.lsp"), 1);
  assert.equal(changes, 1);
  assert.equal(new ManagedLanguageRecommendationPreferences(storage).isSuppressed(identity()), true);
  assert.equal(preferences.clear("/repo", "dev.asterlyn.lsp"), 1);
  assert.equal(preferences.isSuppressed(identity()), false);
  assert.equal(changes, 2);
});

test("invalid, oversized and unknown persisted values suppress nothing", () => {
  for (const value of [
    "not json",
    JSON.stringify({ version: 2, entries: [identity()] }),
    JSON.stringify({ version: 1, entries: [{ ...identity(), authority: true }] }),
    "x".repeat(256 * 1024 + 1),
  ]) {
    const storage = new MemoryStorage();
    storage.value = value;
    const preferences = new ManagedLanguageRecommendationPreferences(storage);
    assert.equal(preferences.isSuppressed(identity()), false);
    assert.equal(preferences.count("/repo", "dev.asterlyn.lsp"), 0);
  }
});

test("preference history is bounded and storage events synchronize another window", () => {
  const storage = new MemoryStorage();
  const events = new StorageEvents();
  const first = new ManagedLanguageRecommendationPreferences(storage);
  const second = new ManagedLanguageRecommendationPreferences(storage, events);
  let externalChanges = 0;
  second.subscribe(() => { externalChanges += 1; });
  for (let index = 0; index < 140; index += 1) {
    first.suppress(identity(`/repo-${index}`));
  }
  events.emit(storage.value);
  assert.equal(second.isSuppressed(identity("/repo-0")), false);
  assert.equal(second.isSuppressed(identity("/repo-139")), true);
  assert.equal(externalChanges, 1);
  second.dispose();
  events.emit(JSON.stringify({ version: 1, entries: [] }));
  assert.equal(externalChanges, 1);
});
