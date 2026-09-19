import assert from "node:assert/strict";
import test from "node:test";

import { GitHistoryPresentationRuntime } from "../src/features/git-history/git-history-presentation-runtime.ts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  };
}

test("Git History presentation runtime owns and resets synchronous feature state", () => {
  const runtime = new GitHistoryPresentationRuntime(memoryStorage(), {
    current: () => null,
    checkout: async () => undefined,
    create: async () => undefined,
  });

  runtime.filters.setTextQuery("needle");
  runtime.detail.show("comparison");
  runtime.branches.setSelectedBranch(".:local:main");
  runtime.folderDiff.open({
    kind: "directory",
    repositoryRoot: "/repo",
    repositoryId: ".",
    oid: "abc123",
    path: "src",
    descendants: [],
  });

  assert.equal(runtime.filterState.historyQuery, "needle");
  assert.equal(runtime.detailState.gitDetail, "comparison");

  runtime.resetWorkspace();

  assert.equal(runtime.filterState.historyQuery, "");
  assert.equal(runtime.detailState.gitDetail, "commit");
  assert.equal(runtime.branches.state.selectedBranch, null);
  assert.equal(runtime.folderDiff.state.target, null);
  assert.equal(runtime.rangeSelection.selection, null);
});
