import assert from "node:assert/strict";
import test from "node:test";

import {
  loadHistoryRefPreferences,
  saveHistoryRefPreferences,
  toggleFavoriteRef,
  touchRecentRef,
} from "../src/workbench/history-preferences.ts";

test("history ref preferences are isolated per repository and discard missing refs", () => {
  const storage = memoryStorage();
  saveHistoryRefPreferences(storage, "/one", {
    favoriteRefs: ["refs/heads/main", "refs/heads/missing"],
    recentRefs: ["refs/heads/topic", "refs/heads/main"],
  });
  saveHistoryRefPreferences(storage, "/two", {
    favoriteRefs: ["refs/tags/v1"],
    recentRefs: [],
  });

  assert.deepEqual(
    loadHistoryRefPreferences(storage, "/one", ["refs/heads/main", "refs/heads/topic"]),
    {
      favoriteRefs: ["refs/heads/main"],
      recentRefs: ["refs/heads/topic", "refs/heads/main"],
    },
  );
  assert.deepEqual(loadHistoryRefPreferences(storage, "/two", ["refs/tags/v1"]), {
    favoriteRefs: ["refs/tags/v1"],
    recentRefs: [],
  });
});

test("favorite choices are explicit and recent refs are deduplicated and bounded", () => {
  let preferences = { favoriteRefs: [], recentRefs: [] };
  preferences = toggleFavoriteRef(preferences, "refs/heads/main");
  preferences = toggleFavoriteRef(preferences, "refs/heads/main");
  assert.deepEqual(preferences.favoriteRefs, []);

  for (let index = 0; index < 10; index += 1) {
    preferences = touchRecentRef(preferences, `refs/heads/${index}`);
  }
  preferences = touchRecentRef(preferences, "refs/heads/5");
  assert.equal(preferences.recentRefs.length, 8);
  assert.equal(preferences.recentRefs[0], "refs/heads/5");
  assert.equal(new Set(preferences.recentRefs).size, preferences.recentRefs.length);
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}
