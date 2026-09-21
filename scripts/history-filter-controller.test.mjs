import assert from "node:assert/strict";
import test from "node:test";

import {
  HistoryFilterController,
} from "../src/features/git-history/history-filter-controller.ts";
import { historyPathChildren } from "../src/features/git-history/history-path-selection.ts";

test("history filter controller owns query normalization and repository reconciliation", () => {
  const controller = new HistoryFilterController(memoryStorage());
  const state = controller.state;
  controller.install({
    repositoryIds: ["removed"],
    refs: [
      { repositoryId: ".", fullName: "refs/heads/main" },
      { repositoryId: ".", fullName: "refs/heads/stale" },
    ],
    startCommit: null,
    authorEmails: ["developer@example.com"],
    currentAuthor: false,
    sinceEpoch: null,
    paths: [{ repositoryId: "removed", path: "src/old.ts" }],
    firstParent: true,
    excludeMerges: false,
    order: "topological",
  });
  controller.reconcile(snapshot());

  assert.deepEqual(Array.from(state.historyRefs.values()), [
    { repositoryId: ".", fullName: "refs/heads/main" },
  ]);
  assert.deepEqual(Array.from(state.historyPaths), []);
  assert.deepEqual(Array.from(state.historyRepositoryIds), []);
  assert.deepEqual(controller.query().authorEmails, ["developer@example.com"]);
  assert.equal(controller.query().firstParent, true);
});

test("history filter controller installs an exact cross-feature query", () => {
  const controller = new HistoryFilterController(memoryStorage());
  const state = controller.state;
  controller.toggleCollapseLinear();
  controller.install({
    repositoryIds: ["."],
    refs: [],
    startCommit: { repositoryId: ".", oid: "a".repeat(40) },
    authorEmails: ["developer@example.com"],
    currentAuthor: false,
    sinceEpoch: null,
    paths: [{ repositoryId: ".", path: "src" }],
    firstParent: false,
    excludeMerges: false,
    order: "topological",
  });
  assert.deepEqual(controller.query().paths, [{ repositoryId: ".", path: "src" }]);
  assert.deepEqual(controller.query().repositoryIds, ["."]);
  assert.deepEqual(controller.query().startCommit, {
    repositoryId: ".",
    oid: "a".repeat(40),
  });
  assert.equal(state.historyCollapseLinear, true);
});

test("history filter preferences and recent paths remain repository scoped", () => {
  const storage = memoryStorage();
  const controller = new HistoryFilterController(storage);
  const state = controller.state;
  const branch = snapshot().branches[0];
  controller.toggleFavorite("/repo", branch);
  controller.recordRecentRef("/repo", { repositoryId: ".", fullName: branch.fullName });
  controller.recordRecentPath({ repositoryId: ".", path: "src/app.ts" });

  const restoredController = new HistoryFilterController(storage);
  restoredController.loadPreferences(snapshot());
  const restored = restoredController.state;
  assert.equal(restored.historyFavoriteRefs.size, 1);
  assert.equal(restored.historyRecentRefs.length, 1);
  assert.deepEqual(state.historyRecentPaths, [{ repositoryId: ".", path: "src/app.ts" }]);
});

test("history filter controller owns text, menus, and branch dialog drafts", () => {
  const controller = new HistoryFilterController(memoryStorage());
  controller.setTextQuery("fix:");
  controller.toggleTextMode("case");
  controller.toggleMenu("branch");
  assert.equal(controller.state.historyQuery, "fix:");
  assert.equal(controller.state.historyCaseSensitive, true);
  assert.equal(controller.state.historyFilterMenu, "branch");

  controller.openDialog("branches", []);
  const reference = { repositoryId: ".", fullName: "refs/heads/main" };
  controller.setRefDraft(".:refs/heads/main", reference, true);
  const result = controller.applyDialog([], messages());
  assert.equal(result.status, "applied");
  assert.equal(result.kind, "branches");
  assert.deepEqual(Array.from(result.refs.values()), [reference]);
  assert.equal(controller.state.historyDialog, null);
  assert.equal(controller.state.historyFilterMenu, null);
});

test("history path dialogs validate text and normalize overlapping tree choices", () => {
  const controller = new HistoryFilterController(memoryStorage());
  const files = [
    { repositoryId: ".", path: "src/app.ts", workspacePath: "src/app.ts" },
    { repositoryId: ".", path: "src/lib.ts", workspacePath: "src/lib.ts" },
  ];
  controller.openDialog("paths-text", files);
  controller.setPathText("missing.ts");
  assert.deepEqual(controller.applyDialog(files, messages()), {
    status: "error",
    error: "unknown:missing.ts",
  });
  assert.equal(controller.state.historyDialog, "paths-text");

  controller.setPathText("src/app.ts");
  const textResult = controller.applyDialog(files, messages());
  assert.equal(textResult.status, "applied");
  assert.deepEqual(Array.from(textResult.paths.values()), [
    { repositoryId: ".", path: "src/app.ts" },
  ]);

  controller.openDialog("paths-tree", files);
  controller.setPathDraft(".:src/app.ts", { repositoryId: ".", path: "src/app.ts" }, true);
  controller.setPathDraft(".:src", { repositoryId: ".", path: "src" }, true);
  const treeResult = controller.applyDialog(files, messages());
  assert.equal(treeResult.status, "applied");
  assert.deepEqual(Array.from(treeResult.paths.values()), [
    { repositoryId: ".", path: "src" },
  ]);
});

test("history filter chips clear only their owned query dimension", () => {
  const controller = new HistoryFilterController(memoryStorage());
  controller.install({
    repositoryIds: ["."],
    refs: [{ repositoryId: ".", fullName: "refs/heads/main" }],
    startCommit: null,
    authorEmails: ["developer@example.com"],
    currentAuthor: true,
    sinceEpoch: 123,
    paths: [{ repositoryId: ".", path: "src" }],
    firstParent: false,
    excludeMerges: false,
    order: "topological",
  });

  controller.clearFilter("user");
  assert.equal(controller.query().refs.length, 1);
  assert.equal(controller.query().authorEmails.length, 0);
  assert.equal(controller.query().currentAuthor, false);
  assert.equal(controller.query().paths.length, 1);

  controller.clearFilter("paths");
  assert.equal(controller.query().paths.length, 0);
  assert.equal(controller.query().repositoryIds.length, 0);
});

test("history path tree projects only the requested level", () => {
  const files = [
    { repositoryId: ".", path: "src/features/app.ts", workspacePath: "src/features/app.ts" },
    { repositoryId: ".", path: "src/index.ts", workspacePath: "src/index.ts" },
    { repositoryId: ".", path: "README.md", workspacePath: "README.md" },
  ];
  assert.deepEqual(historyPathChildren(files, ".").map(({ path, directory }) => ({ path, directory })), [
    { path: "src", directory: true },
    { path: "README.md", directory: false },
  ]);
  assert.deepEqual(historyPathChildren(files, ".", "src").map(({ path, directory }) => ({ path, directory })), [
    { path: "src/features", directory: true },
    { path: "src/index.ts", directory: false },
  ]);
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

function messages() {
  return {
    unknownTrackedPath: (path) => `unknown:${path}`,
    ambiguousTrackedPath: (path) => `ambiguous:${path}`,
  };
}
