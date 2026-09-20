import assert from "node:assert/strict";
import test from "node:test";

import { ConflictEditorRuntime } from "../src/features/git-operations/conflict-editor-runtime.ts";
import { GitOperationController } from "../src/features/git-operations/git-operation-controller.ts";
import { EN_US } from "../src/localization/en-US.ts";
import { DEFAULT_APP_PREFERENCES } from "../src/preferences.ts";

test("opening a conflict activates an editor document without opening a modal", async () => {
  const controller = new GitOperationController(gateway());
  controller.installSnapshot(snapshot());
  const harness = runtimeHarness(controller);

  await harness.runtime.open("one.txt");

  assert.deepEqual(harness.active(), {
    kind: "conflict-resolution",
    repositoryRoot: "/repo",
    path: "one.txt",
  });
  assert.equal(controller.state.dialog, null);
  assert.equal(controller.state.conflict?.path, "one.txt");
  harness.runtime.capture();
  assert.equal(controller.state.conflictResult, "markers\n");
  assert.ok(harness.renderCount() >= 1);
});

test("an edited conflict draft blocks replacing the editor with another conflict", async () => {
  const controller = new GitOperationController(gateway());
  controller.installSnapshot(snapshot());
  const harness = runtimeHarness(controller);
  await harness.runtime.open("one.txt");
  controller.setConflictResult("edited result");

  await harness.runtime.open("two.txt");

  assert.equal(harness.active().path, "one.txt");
  assert.equal(controller.state.conflict?.path, "one.txt");
  assert.equal(harness.statuses().at(-1), EN_US.gitOperations.discardConflict);
});

function runtimeHarness(controller) {
  let active = { kind: "welcome" };
  let renders = 0;
  const statuses = [];
  const runtime = new ConflictEditorRuntime({
    root: { querySelector() { return null; } },
    controller,
    editor: { closePreview() { active = { kind: "welcome" }; } },
    surface: { flushConflict() { return null; } },
    snapshot: () => snapshot(),
    activeDocument: () => active,
    activate(document) { active = document; },
    renderEditor() { renders += 1; },
    preferences: () => DEFAULT_APP_PREFERENCES,
    copy: () => EN_US.gitOperations,
    editorCopy: () => EN_US.editor,
    status(message) { statuses.push(message); },
    resolve() {},
  });
  return {
    runtime,
    active: () => active,
    renderCount: () => renders,
    statuses: () => statuses,
  };
}

function gateway() {
  return {
    async prepareGitOperation() { throw new Error("not used"); },
    async executeGitOperation() { throw new Error("not used"); },
    async runGitOperationAction() { throw new Error("not used"); },
    async readConflictContent(_root, path) {
      return {
        path,
        base: "base\n",
        ours: "ours\n",
        theirs: "theirs\n",
        worktree: "markers\n",
        binary: false,
        revisionToken: `revision:${path}`,
      };
    },
    async resolveConflict() { throw new Error("not used"); },
  };
}

function snapshot() {
  const conflicts = ["one.txt", "two.txt"].map((path) => ({
    path,
    baseOid: "b".repeat(40),
    oursOid: "o".repeat(40),
    theirsOid: "t".repeat(40),
  }));
  return {
    root: "/repo",
    gitDir: "/repo/.git",
    repositoryRoots: [],
    branch: {
      head: "main", oid: "a".repeat(40), upstream: null, upstreamRemote: null,
      upstreamRef: null, ahead: 0, behind: 0, detached: false, unborn: false,
    },
    operation: {
      kind: "merge", phase: "conflicted", originalHeadOid: "a".repeat(40),
      currentHeadOid: "a".repeat(40), headRef: "refs/heads/main",
      targetOids: ["c".repeat(40)], conflicts,
      progress: { current: null, total: null, detail: null }, allowedActions: ["abort"],
    },
    changes: conflicts.map(({ path }) => ({
      path, originalPath: null, indexStatus: "unmerged", worktreeStatus: "unmerged",
      conflicted: true, submodule: false,
    })),
    commits: [], branches: [], remotes: [], untrackedState: "complete",
  };
}
