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
  assert.equal(controller.state.conflictResult, "base\n");
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

test("a stash-pop worktree conflict opens the three-pane editor without operation metadata", async () => {
  const repository = snapshot();
  repository.operation = null;
  const controller = new GitOperationController(gateway());
  controller.installSnapshot(repository);
  const harness = runtimeHarness(controller, repository);

  await harness.runtime.open("one.txt");

  assert.equal(controller.state.conflict?.path, "one.txt");
  assert.equal(harness.active().kind, "conflict-resolution");
});

test("Cancel reuses discard confirmation and clears only the transient draft", async () => {
  const controller = new GitOperationController(gateway());
  controller.installSnapshot(snapshot());
  const rejected = runtimeHarness(controller, snapshot(), { discard: false });
  await rejected.runtime.open("one.txt");
  controller.setConflictResult("edited result");

  assert.equal(await rejected.runtime.requestCancel(), false);
  assert.equal(controller.state.conflict?.path, "one.txt");

  const accepted = runtimeHarness(controller, snapshot(), { discard: true });
  assert.equal(await accepted.runtime.requestCancel(), true);
  assert.equal(controller.state.conflict, null);
  assert.equal(accepted.active().kind, "welcome");
});

test("Save and Stage confirms pending blocks without weakening resolve verification", async () => {
  const controller = new GitOperationController(gateway());
  controller.installSnapshot(snapshot());
  const rejected = runtimeHarness(controller, snapshot(), { pending: false });
  await rejected.runtime.open("one.txt");

  assert.equal(await rejected.runtime.requestSave(2), false);
  assert.deepEqual(rejected.resolutions(), []);

  const accepted = runtimeHarness(controller, snapshot(), { pending: true });
  assert.equal(await accepted.runtime.requestSave(2), true);
  assert.deepEqual(accepted.resolutions(), [false]);
});

function runtimeHarness(controller, repository = snapshot(), confirmations = {}) {
  let active = { kind: "welcome" };
  let renders = 0;
  const statuses = [];
  const resolutions = [];
  const runtime = new ConflictEditorRuntime({
    root: { querySelector() { return null; } },
    controller,
    editor: { closePreview() { active = { kind: "welcome" }; } },
    surface: { flushConflict() { return null; }, conflictReviewSummary() { return null; } },
    snapshot: () => repository,
    activeDocument: () => active,
    activate(document) { active = document; },
    renderEditor() { renders += 1; },
    preferences: () => DEFAULT_APP_PREFERENCES,
    presentation: () => ({ layout: "split", showWhitespace: false }),
    copy: () => EN_US.gitOperations,
    editorCopy: () => EN_US.editor,
    status(message) { statuses.push(message); },
    resolve(deleteFile) { resolutions.push(deleteFile); },
    setWhitespace() {},
    confirmDiscard: async () => confirmations.discard ?? true,
    confirmPending: async () => confirmations.pending ?? true,
  });
  return {
    runtime,
    active: () => active,
    renderCount: () => renders,
    statuses: () => statuses,
    resolutions: () => resolutions,
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
        worktree: "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> topic\n",
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
