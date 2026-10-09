import assert from "node:assert/strict";
import test from "node:test";

import { GitOperationRuntime } from "../src/features/git-operations/git-operation-runtime.ts";
import { EN_US } from "../src/localization/en-US.ts";

test("Git operation runtime owns controller notification and disposal", () => {
  const changes = [];
  const runtime = new GitOperationRuntime({
    root: { querySelector: () => null },
    gateway: {},
    initialCopy: EN_US.gitOperations,
    copy: () => EN_US.gitOperations,
    actions: {
      prepare: () => {},
      execute: () => {},
      resolve: () => {},
      confirmDiscard: async () => true,
      reportError: () => {},
    },
    changed: (change) => changes.push(change.reason),
  });

  runtime.controller.installSnapshot(null);
  assert.deepEqual(changes, ["snapshot"]);
  runtime.dispose();
  runtime.dispose();
  runtime.controller.installSnapshot(null);
  assert.deepEqual(changes, ["snapshot"]);
});

test("Git operation runtime rejects late recovery-dialog activation after disposal", async () => {
  const runtime = new GitOperationRuntime({
    root: { querySelector: () => null },
    gateway: {},
    initialCopy: EN_US.gitOperations,
    copy: () => EN_US.gitOperations,
    actions: {
      prepare: () => {},
      execute: () => {},
      resolve: () => {},
      confirmDiscard: async () => true,
      reportError: () => {},
    },
    changed: () => {},
    recovery: {
      actions: {
        activeRoot: () => "/repo",
        list: async () => [],
        confirmUndo: async () => true,
        undo: async () => {},
      },
      copy: () => ({}),
    },
  });

  const opening = runtime.openRecoveries("/repo");
  runtime.dispose();
  await opening;
  assert.equal(runtime.controller.state.dialog, null);
});

test("closing a conflict through the aggregate runtime clears the conflict session and preview", async () => {
  let active = { kind: "welcome" };
  let previewCloses = 0;
  const repository = conflictedSnapshot();
  const runtime = new GitOperationRuntime({
    root: { querySelector: () => null },
    gateway: {
      async readConflictContent(_root, path) {
        return {
          path,
          base: "base\n",
          ours: "ours\n",
          theirs: "theirs\n",
          worktree: "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> topic\n",
          binary: false,
          revisionToken: "revision",
        };
      },
    },
    initialCopy: EN_US.gitOperations,
    copy: () => EN_US.gitOperations,
    actions: {
      prepare: () => {}, execute: () => {}, resolve: () => {},
      confirmDiscard: async () => true, reportError: () => {},
    },
    changed: () => {},
    conflictEditor: {
      root: { querySelector: () => null },
      editor: { closePreview() { active = { kind: "welcome" }; previewCloses += 1; } },
      surface: {
        flushConflict: () => null,
        conflictReviewSummary: () => null,
      },
      snapshot: () => repository,
      activeDocument: () => active,
      activate(document) { active = document; },
      selectConflict() {}, renderEditor() {},
      preferences: () => ({}), presentation: () => ({ layout: "split", showWhitespace: false }),
      copy: () => EN_US.gitOperations, editorCopy: () => ({}), status() {}, resolve() {},
      setDiffLayout() {}, setWhitespace() {}, conflictSourceAvailable: () => true,
      revealConflictSource() {}, notifyBlockedSwitch: async () => {},
    },
  });
  runtime.controller.installSnapshot(repository);
  assert.equal(await runtime.openConflict("shared.txt"), true);

  assert.equal(await runtime.close(), true);
  assert.equal(runtime.controller.state.conflict, null);
  assert.equal(active.kind, "welcome");
  assert.ok(previewCloses >= 1);
});

function conflictedSnapshot() {
  return {
    root: "/repo",
    gitDir: "/repo/.git",
    repositoryRoots: [],
    branch: null,
    operation: null,
    changes: [{
      path: "shared.txt", originalPath: null, indexStatus: "unmerged",
      worktreeStatus: "unmerged", conflicted: true, submodule: false,
    }],
    commits: [], branches: [], remotes: [], untrackedState: "complete",
  };
}
