import assert from "node:assert/strict";
import test from "node:test";

import {
  HistoryFilterController,
  createHistoryFilterState,
} from "../src/features/git-history/history-filter-controller.ts";

test("history filter controller owns query normalization and repository reconciliation", () => {
  const state = createHistoryFilterState();
  const controller = new HistoryFilterController(state, memoryStorage());
  state.historyRefs.set("stale", { repositoryId: ".", fullName: "refs/heads/stale" });
  state.historyPaths.set("stale", { repositoryId: "removed", path: "src/old.ts" });
  state.historyRepositoryIds.add("removed");
  controller.reconcile(snapshot());

  assert.deepEqual(Array.from(state.historyRefs), []);
  assert.deepEqual(Array.from(state.historyPaths), []);
  assert.deepEqual(Array.from(state.historyRepositoryIds), []);
  state.historyAuthorEmails.add("developer@example.com");
  state.historyFirstParent = true;
  assert.deepEqual(controller.query().authorEmails, ["developer@example.com"]);
  assert.equal(controller.query().firstParent, true);
});

test("history filter preferences and recent paths remain repository scoped", () => {
  const state = createHistoryFilterState();
  const storage = memoryStorage();
  const controller = new HistoryFilterController(state, storage);
  const branch = snapshot().branches[0];
  controller.toggleFavorite("/repo", branch);
  controller.recordRecentRef("/repo", { repositoryId: ".", fullName: branch.fullName });
  controller.recordRecentPath({ repositoryId: ".", path: "src/app.ts" });

  const restored = createHistoryFilterState();
  new HistoryFilterController(restored, storage).loadPreferences(snapshot());
  assert.equal(restored.historyFavoriteRefs.size, 1);
  assert.equal(restored.historyRecentRefs.length, 1);
  assert.deepEqual(state.historyRecentPaths, [{ repositoryId: ".", path: "src/app.ts" }]);
});

function snapshot() {
  return {
    root: "/repo",
    gitDir: "/repo/.git",
    repositoryRoots: [{ id: ".", relativePath: ".", displayName: "repo", kind: "main" }],
    branch: {},
    operation: null,
    changes: [],
    commits: [],
    branches: [{
      repositoryId: ".",
      kind: "local",
      name: "main",
      fullName: "refs/heads/main",
      oid: "a".repeat(40),
      current: true,
      remote: null,
      subject: "main",
      committedAt: 1,
    }],
    remotes: [],
    untrackedState: "complete",
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
    clear() { values.clear(); },
    key(index) { return Array.from(values.keys())[index] ?? null; },
    get length() { return values.size; },
  };
}
