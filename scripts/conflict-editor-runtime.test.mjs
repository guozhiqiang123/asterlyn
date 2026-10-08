import assert from "node:assert/strict";
import test from "node:test";

import { ConflictEditorRuntime, conflictFileNavigation, conflictReviewCompletionReady } from "../src/features/git-operations/conflict-editor-runtime.ts";
import { GitOperationController } from "../src/features/git-operations/git-operation-controller.ts";
import { EN_US } from "../src/localization/en-US.ts";
import { DEFAULT_APP_PREFERENCES } from "../src/preferences.ts";

test("opening a conflict activates an editor document without opening a modal", async () => {
  const controller = new GitOperationController(gateway());
  controller.installSnapshot(snapshot());
  const harness = runtimeHarness(controller);

  assert.equal(await harness.runtime.open("one.txt"), true);

  assert.deepEqual(harness.active(), {
    kind: "conflict-resolution",
    repositoryRoot: "/repo",
    path: "one.txt",
  });
  assert.equal(controller.state.dialog, null);
  assert.equal(controller.state.conflict?.path, "one.txt");
  assert.deepEqual(harness.selections(), ["one.txt"]);
  harness.runtime.capture();
  assert.equal(controller.state.conflictResult, "base\n");
  assert.ok(harness.renderCount() >= 1);
});

test("an edited conflict draft blocks selection and editor activation for another conflict", async () => {
  const controller = new GitOperationController(gateway());
  controller.installSnapshot(snapshot());
  const harness = runtimeHarness(controller);
  await harness.runtime.open("one.txt");
  controller.setConflictResult("edited result");

  assert.equal(await harness.runtime.open("two.txt"), false);

  assert.equal(harness.active().path, "one.txt");
  assert.equal(controller.state.conflict?.path, "one.txt");
  assert.deepEqual(harness.selections(), ["one.txt"]);
  assert.equal(harness.blockedNotices(), 1);
});

test("decision-only conflict drafts also block switching before selection changes", async () => {
  const controller = new GitOperationController(gateway());
  controller.installSnapshot(snapshot());
  const harness = runtimeHarness(controller, snapshot(), { reviewPending: 1 });
  assert.equal(await harness.runtime.open("one.txt"), true);
  assert.equal(controller.hasUnsavedConflict(), false);

  assert.equal(await harness.runtime.open("two.txt"), false);
  assert.deepEqual(harness.selections(), ["one.txt"]);
  assert.equal(harness.active().path, "one.txt");
  assert.equal(harness.blockedNotices(), 1);
});

test("automatically merged review presentation does not block untouched conflict switching", async () => {
  const controller = new GitOperationController(gateway());
  controller.installSnapshot(snapshot());
  const harness = runtimeHarness(controller, snapshot(), {
    reviewPending: 1,
    explicitlyReviewed: 0,
  });
  assert.equal(await harness.runtime.open("one.txt"), true);
  assert.equal(controller.hasUnsavedConflict(), false);

  assert.equal(await harness.runtime.open("two.txt"), true);
  assert.deepEqual(harness.selections(), ["one.txt", "two.txt"]);
  assert.equal(harness.active().path, "two.txt");
  assert.equal(harness.blockedNotices(), 0);
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

test("conflict file navigation follows the exact deduplicated conflict order", () => {
  const repository = snapshot();
  repository.operation.conflicts.push({
    path: "operation-only.txt",
    baseOid: "b".repeat(40),
    oursOid: "o".repeat(40),
    theirsOid: "t".repeat(40),
  });

  assert.deepEqual(conflictFileNavigation(repository, "one.txt"), {
    previous: null,
    next: "two.txt",
  });
  assert.deepEqual(conflictFileNavigation(repository, "two.txt"), {
    previous: "one.txt",
    next: "operation-only.txt",
  });
  assert.deepEqual(conflictFileNavigation(repository, "operation-only.txt"), {
    previous: "two.txt",
    next: null,
  });
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

test("Save and Stage stays blocked until every conflict block is explicitly completed", async () => {
  const controller = new GitOperationController(gateway());
  controller.installSnapshot(snapshot());
  const pending = runtimeHarness(controller, snapshot(), { reviewPending: 2 });
  await pending.runtime.open("one.txt");

  assert.equal(await pending.runtime.requestSave(), false);
  assert.deepEqual(pending.resolutions(), []);

  const completedController = new GitOperationController(gateway());
  completedController.installSnapshot(snapshot());
  const completed = runtimeHarness(completedController, snapshot(), { reviewPending: 0 });
  await completed.runtime.open("one.txt");
  assert.equal(await completed.runtime.requestSave(), true);
  assert.deepEqual(completed.resolutions(), [false]);
  assert.equal(conflictReviewCompletionReady(null), false);
  assert.equal(conflictReviewCompletionReady({
    ...reviewSummary(16, 0), total: 18, conflicts: 0, nonConflicting: 16,
  }), true);
});

function runtimeHarness(controller, repository = snapshot(), confirmations = {}) {
  let active = { kind: "welcome" };
  let renders = 0;
  const statuses = [];
  const resolutions = [];
  const selections = [];
  let blockedNotices = 0;
  const runtime = new ConflictEditorRuntime({
    root: { querySelector() { return null; } },
    controller,
    editor: { closePreview() { active = { kind: "welcome" }; } },
    surface: {
      flushConflict() { return null; },
      conflictReviewSummary() {
        return active.kind !== "conflict-resolution" || confirmations.reviewPending === undefined
          ? null
          : reviewSummary(
              confirmations.reviewPending,
              confirmations.reviewPending,
              confirmations.explicitlyReviewed,
            );
      },
    },
    snapshot: () => repository,
    activeDocument: () => active,
    activate(document) { active = document; },
    selectConflict(path) { selections.push(path); },
    renderEditor() { renders += 1; },
    preferences: () => DEFAULT_APP_PREFERENCES,
    presentation: () => ({ layout: "split", showWhitespace: false }),
    copy: () => EN_US.gitOperations,
    editorCopy: () => EN_US.editor,
    status(message) { statuses.push(message); },
    resolve(deleteFile) { resolutions.push(deleteFile); },
    setDiffLayout() {},
    setWhitespace() {},
    conflictSourceAvailable() { return true; },
    revealConflictSource() {},
    confirmDiscard: async () => confirmations.discard ?? true,
    async notifyBlockedSwitch() { blockedNotices += 1; },
  });
  return {
    runtime,
    active: () => active,
    renderCount: () => renders,
    statuses: () => statuses,
    resolutions: () => resolutions,
    selections: () => selections,
    blockedNotices: () => blockedNotices,
  };
}

function reviewSummary(pending, pendingConflicts = pending, explicitlyReviewed = 2 - pending) {
  return {
    total: 2,
    conflicts: 2,
    nonConflicting: 0,
    identical: 0,
    pending,
    pendingConflicts,
    reviewed: 2 - pending,
    explicitlyReviewed,
    manual: 0,
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
