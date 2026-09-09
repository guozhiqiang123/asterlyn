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
    favoriteRefs: [ref("refs/heads/main"), ref("refs/heads/missing")],
    recentRefs: [ref("refs/heads/topic"), ref("refs/heads/main")],
  });
  saveHistoryRefPreferences(storage, "/two", {
    favoriteRefs: [ref("refs/tags/v1")],
    recentRefs: [],
  });

  assert.deepEqual(
    loadHistoryRefPreferences(storage, "/one", [ref("refs/heads/main"), ref("refs/heads/topic")]),
    {
      favoriteRefs: [ref("refs/heads/main")],
      recentRefs: [ref("refs/heads/topic"), ref("refs/heads/main")],
    },
  );
  assert.deepEqual(loadHistoryRefPreferences(storage, "/two", [ref("refs/tags/v1")]), {
    favoriteRefs: [ref("refs/tags/v1")],
    recentRefs: [],
  });
});

test("favorite choices are explicit and recent refs are deduplicated and bounded", () => {
  let preferences = { favoriteRefs: [], recentRefs: [] };
  preferences = toggleFavoriteRef(preferences, ref("refs/heads/main"));
  preferences = toggleFavoriteRef(preferences, ref("refs/heads/main"));
  assert.deepEqual(preferences.favoriteRefs, []);

  for (let index = 0; index < 10; index += 1) {
    preferences = touchRecentRef(preferences, ref(`refs/heads/${index}`));
  }
  preferences = touchRecentRef(preferences, ref("refs/heads/5"));
  assert.equal(preferences.recentRefs.length, 8);
  assert.deepEqual(preferences.recentRefs[0], ref("refs/heads/5"));
  assert.equal(
    new Set(preferences.recentRefs.map((item) => `${item.repositoryId}:${item.fullName}`)).size,
    preferences.recentRefs.length,
  );
});

test("legacy unqualified refs migrate only to the main root", () => {
  const storage = memoryStorage();
  storage.setItem(
    `asterlyn.historyRefs.v1.${encodeURIComponent("/legacy")}`,
    JSON.stringify({ favoriteRefs: ["refs/heads/main"], recentRefs: ["refs/heads/main"] }),
  );
  assert.deepEqual(
    loadHistoryRefPreferences(storage, "/legacy", [
      ref("refs/heads/main"),
      { repositoryId: "module", fullName: "refs/heads/main" },
    ]),
    { favoriteRefs: [ref("refs/heads/main")], recentRefs: [ref("refs/heads/main")] },
  );
});

function ref(fullName) {
  return { repositoryId: ".", fullName };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}
