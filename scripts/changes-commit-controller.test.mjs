import assert from "node:assert/strict";
import test from "node:test";

import { ChangesCommitController } from "../src/features/changes-commit/changes-commit-controller.ts";
import { fileChangeKey } from "../src/change-identity.ts";

test("snapshot reconciliation retains valid inclusion and selection identities", () => {
  const controller = new ChangesCommitController(gateway());
  controller.installSnapshot(snapshot([change("a.txt"), change("b.txt")]));
  controller.setPathsIncluded([fileChangeKey(change("b.txt"))], false);
  controller.selectChange("a.txt");

  controller.installSnapshot(snapshot([change("b.txt"), change("c.txt")]));
  assert.equal(controller.state.selectedChange?.path, "b.txt");
  assert.deepEqual([...controller.state.excludedPaths], [fileChangeKey(change("b.txt"))]);
  assert.deepEqual(controller.includedChanges().map(({ path }) => path), ["c.txt"]);
});

test("untracked scan state updates navigation without invalidating stable inclusion or Diff state", () => {
  const controller = new ChangesCommitController(gateway());
  const events = [];
  const current = snapshot([change("a.txt")]);
  controller.installSnapshot(current);
  controller.subscribe((event) => events.push(event));

  controller.installSnapshot({ ...current, changes: current.changes.map((item) => ({ ...item })), untrackedState: "pending" });
  assert.deepEqual(events, [{
    reason: "snapshot",
    navigationChanged: true,
    selectionChanged: false,
    inclusionChanged: false,
    composerChanged: false,
    diffChanged: false,
  }]);

  events.length = 0;
  controller.installSnapshot({ ...current, changes: current.changes.map((item) => ({ ...item })) });
  assert.deepEqual(events, [{
    reason: "snapshot",
    navigationChanged: true,
    selectionChanged: false,
    inclusionChanged: false,
    composerChanged: false,
    diffChanged: false,
  }]);
  events.length = 0;
  controller.installSnapshot({ ...current, changes: current.changes.map((item) => ({ ...item })) });
  assert.deepEqual(events, []);
});

test("latest change selection owns working Diff completion", async () => {
  const first = deferred();
  const second = deferred();
  const controller = new ChangesCommitController(gateway({
    diffResponses: [first.promise, second.promise],
  }));
  controller.installSnapshot(snapshot([change("a.txt"), change("b.txt")]));

  controller.selectChange("a.txt");
  const a = controller.loadSelectedDiff(false);
  controller.selectChange("b.txt");
  const b = controller.loadSelectedDiff(true);
  first.resolve(diff("a.txt"));
  await a;
  assert.equal(controller.state.workingPatch, null);

  second.resolve(diff("b.txt"));
  await b;
  assert.equal(controller.state.workingPatch?.path, "b.txt");
  assert.equal(controller.state.workingDiffBase?.content, "base:b.txt\n");
  assert.equal(controller.state.workingPatchLoading, false);
});

test("an unavailable editable base preserves the read-only patch fallback", async () => {
  const controller = new ChangesCommitController(gateway({
    readWorkingDiffBase() { throw new Error("not editable"); },
  }));
  controller.installSnapshot(snapshot([change("a.txt")]));

  await controller.loadSelectedDiff(false);

  assert.equal(controller.state.workingPatch?.path, "a.txt");
  assert.equal(controller.state.workingDiffBase, null);
  assert.equal(controller.state.workingPatchError, null);
});

test("the visible patch settles before a delayed editable base", async () => {
  const base = deferred();
  const controller = new ChangesCommitController(gateway({
    readWorkingDiffBase() { return base.promise; },
  }));
  controller.installSnapshot(snapshot([change("a.txt")]));

  const loading = controller.loadSelectedDiff(false);
  await nextTask();

  assert.equal(controller.state.workingPatch?.path, "a.txt");
  assert.equal(controller.state.workingPatchLoading, false);
  assert.equal(controller.state.workingDiffBase, null);

  base.resolve(workingBase("a.txt"));
  await loading;
  assert.equal(controller.state.workingDiffBase?.content, "base:a.txt\n");
});

test("a non-settling patch reaches the retry state after its deadline", async () => {
  const controller = new ChangesCommitController(
    gateway({ readLocalDiff: () => new Promise(() => undefined) }),
    "tree",
    timeoutMessages(),
    5,
  );
  controller.installSnapshot(snapshot([change("a.txt")]));

  await controller.loadSelectedDiff(false);

  assert.equal(controller.state.workingPatch, null);
  assert.equal(controller.state.workingPatchLoading, false);
  assert.equal(controller.state.workingPatchError, "Patch timed out");
});

test("a late patch completion cannot replace the retry state after its deadline", async () => {
  const patch = deferred();
  const controller = new ChangesCommitController(
    gateway({ readLocalDiff: () => patch.promise }),
    "tree",
    timeoutMessages(),
    5,
  );
  controller.installSnapshot(snapshot([change("a.txt")]));

  await controller.loadSelectedDiff(false);
  patch.resolve(diff("a.txt", "late"));
  await nextTask();

  assert.equal(controller.state.workingPatch, null);
  assert.equal(controller.state.workingPatchLoading, false);
  assert.equal(controller.state.workingPatchError, "Patch timed out");
});

test("a non-settling editable base cannot keep a ready patch loading", async () => {
  const controller = new ChangesCommitController(
    gateway({ readWorkingDiffBase: () => new Promise(() => undefined) }),
    "tree",
    timeoutMessages(),
    5,
  );
  controller.installSnapshot(snapshot([change("a.txt")]));

  const loading = controller.loadSelectedDiff(false);
  await nextTask();
  assert.equal(controller.state.workingPatch?.path, "a.txt");
  assert.equal(controller.state.workingPatchLoading, false);

  await loading;
  assert.equal(controller.state.workingPatch?.path, "a.txt");
  assert.equal(controller.state.workingPatchError, null);
  assert.equal(controller.state.workingDiffBase, null);
});

test("same-file reconciliation keeps the visible Diff until its refreshed patch arrives", async () => {
  const refreshed = deferred();
  const responses = [Promise.resolve(diff("a.txt", "old")), refreshed.promise];
  const controller = new ChangesCommitController(gateway({
    readLocalDiff() {
      return responses.shift();
    },
  }));
  controller.installSnapshot(snapshot([change("a.txt")]));
  await controller.loadSelectedDiff(false);

  controller.installSnapshot(snapshot([change("a.txt"), change("new.txt")]));
  assert.equal(controller.state.workingPatch?.patch, "old");
  const loading = controller.loadSelectedDiff(false);
  assert.equal(controller.state.workingPatchLoading, true);
  assert.equal(controller.state.workingPatch?.patch, "old");

  refreshed.resolve(diff("a.txt", "new"));
  await loading;
  assert.equal(controller.state.workingPatch?.patch, "new");
  assert.equal(controller.state.workingPatchLoading, false);
});

test("same-file reconciliation with identical diff does not bump workingPatchVersion and emits diffChanged: false", async () => {
  const events = [];
  const controller = new ChangesCommitController(gateway());
  controller.subscribe((change) => events.push(change));
  controller.installSnapshot(snapshot([change("a.txt"), change("b.txt")]));
  await controller.loadSelectedDiff(false);

  const initialVersion = controller.state.workingPatchVersion;
  assert.equal(initialVersion > 0, true);

  events.length = 0;
  // Background AI modifies other file b.txt, triggering snapshot install and reconciliation
  controller.installSnapshot(snapshot([change("a.txt"), change("b.txt"), change("c.txt")]));
  await controller.loadSelectedDiff(false);

  assert.equal(controller.state.workingPatchVersion, initialVersion);
  const diffEvents = events.filter((e) => e.reason === "diff-start" || e.reason === "diff-complete");
  assert.equal(diffEvents.length, 2);
  assert.equal(diffEvents.every((e) => e.diffChanged === false), true);
});

test("context selection moves the row without clearing or retargeting the visible Diff", async () => {
  const controller = new ChangesCommitController(gateway());
  controller.installSnapshot(snapshot([change("a.txt"), change("b.txt")]));
  controller.selectChange("a.txt");
  await controller.loadSelectedDiff(false);

  assert.equal(controller.selectContextChange("b.txt"), true);

  assert.equal(controller.state.selectedChange?.path, "b.txt");
  assert.equal(controller.state.workingDiffPath, "a.txt");
  assert.equal(controller.state.workingPatch?.path, "a.txt");
});

test("image Diff uses the image gateway and shares stale-result protection", async () => {
  const calls = [];
  const controller = new ChangesCommitController(gateway({
    async readLocalImageDiff(_root, selected) {
      calls.push(selected.path);
      return { path: selected.path, before: null, after: null };
    },
  }));
  controller.installSnapshot(snapshot([change("icon.png")]));
  await controller.loadSelectedDiff(false);

  assert.deepEqual(calls, ["icon.png"]);
  assert.equal(controller.state.workingImageDiff?.path, "icon.png");
  assert.equal(controller.state.workingPatch, null);
});

test("commit sends only included files and clears its message after success", async () => {
  const committed = [];
  const controller = new ChangesCommitController(gateway({
    async commitChanges(_root, message, changes) {
      committed.push({ message, paths: changes.map(({ path }) => path) });
      return { oid: "new", snapshot: snapshot([]), refreshError: null, verificationWarning: null };
    },
  }));
  controller.installSnapshot(snapshot([change("a.txt"), change("b.txt")]));
  controller.setPathsIncluded([fileChangeKey(change("b.txt"))], false);
  controller.setCommitMessage("  focused commit  ");

  const result = await controller.commit();
  assert.equal(result.status, "success");
  assert.deepEqual(committed, [{ message: "focused commit", paths: ["a.txt"] }]);
  assert.equal(controller.state.commitMessage, "");
});

test("commit requires one repository and routes an explicitly isolated child selection", async () => {
  const committed = [];
  const controller = new ChangesCommitController(gateway({
    async commitChanges(_root, _message, changes) {
      committed.push(changes.map(({ repositoryId, path }) => [repositoryId, path]));
      return { oid: "child", snapshot: snapshot([]), refreshError: null, verificationWarning: null };
    },
  }));
  const main = change("same.txt");
  const child = {
    ...change("same.txt"), repositoryId: "modules/lib", workspacePath: "modules/lib/same.txt",
  };
  controller.installSnapshot(snapshot([main, child]));
  controller.setCommitMessage("child only");
  assert.equal(controller.canCommit(), false);
  controller.setPathsIncluded([fileChangeKey(main)], false);
  assert.equal(controller.canCommit(), true);
  assert.equal((await controller.commit()).status, "success");
  assert.deepEqual(committed, [[["modules/lib", "same.txt"]]]);
});

test("stash accepts an optional shared message and sends only included files", async () => {
  const calls = [];
  const controller = new ChangesCommitController(gateway({
    async stashChanges(_root, message, changes, keepIndex) {
      calls.push({ message, paths: changes.map(({ path }) => path), keepIndex });
      return { snapshot: snapshot([]), invalidatedSlices: ["workingTree"] };
    },
  }));
  controller.installSnapshot(snapshot([change("a.txt"), change("b.txt")]));
  controller.setPathsIncluded([fileChangeKey(change("b.txt"))], false);

  const result = await controller.stash();
  assert.equal(result.status, "success");
  assert.deepEqual(calls, [{ message: "", paths: ["a.txt"], keepIndex: false }]);
  assert.equal(controller.state.commitMessage, "");
});

test("keep-staged stash is a one-shot variant requiring staged and removable selected work", async () => {
  const calls = [];
  const controller = new ChangesCommitController(gateway({
    async stashChanges(_root, _message, _changes, keepIndex) {
      calls.push(keepIndex);
      return { snapshot: snapshot([]), invalidatedSlices: ["workingTree"] };
    },
  }));
  controller.installSnapshot(snapshot([change("staged.txt", "modified", "unmodified")]));
  assert.equal(controller.hasIncludedStagedChanges(), true);
  assert.equal(controller.canStash(), true);
  assert.equal(controller.canStash(true), false);

  controller.installSnapshot(snapshot([change("mixed.txt", "modified", "modified")]));
  assert.equal(controller.canStash(true), true);
  assert.equal((await controller.stash(true)).status, "success");
  assert.deepEqual(calls, [true]);

  controller.installSnapshot(snapshot([change("working.txt")]));
  assert.equal(controller.hasIncludedStagedChanges(), false);
  assert.equal(controller.canStash(), true);
  assert.equal(controller.canStash(true), false);
});

test("repository replacement invalidates an in-flight revert", async () => {
  const reverted = deferred();
  const controller = new ChangesCommitController(gateway({ revertResponse: reverted.promise }));
  controller.installSnapshot(snapshot([change("a.txt")]));
  const result = controller.revertSelected({ root: "/repo", selected: [change("a.txt")], paths: ["a.txt"], headOid: "base", token: "review" });
  controller.installSnapshot(snapshot([change("b.txt")], "/other"));
  reverted.resolve(snapshot([]));

  assert.deepEqual(await result, { status: "stale" });
  assert.equal(controller.state.mutation, null);
});

function gateway(overrides = {}) {
  const diffResponses = overrides.diffResponses ?? [];
  let diffIndex = 0;
  return {
    readLocalDiff(_root, selected) {
      return diffResponses[diffIndex++] ?? Promise.resolve(diff(selected.path));
    },
    async readWorkingDiffBase(_root, selected) {
      return workingBase(selected.path, selected.originalPath);
    },
    async readLocalImageDiff(_root, selected) {
      return { path: selected.path, before: null, after: null };
    },
    revertChanges() {
      return overrides.revertResponse ?? Promise.resolve(snapshot([]));
    },
    async commitChanges() {
      return { oid: "new", snapshot: snapshot([]), refreshError: null, verificationWarning: null };
    },
    async stashChanges() {
      return { snapshot: snapshot([]), invalidatedSlices: ["workingTree"] };
    },
    ...overrides,
  };
}

function snapshot(changes, root = "/repo") {
  return {
    root,
    gitDir: `${root}/.git`,
    repositoryRoots: [{ id: ".", path: ".", displayName: "repo" }],
    branch: {
      head: "main",
      oid: "a".repeat(40),
      upstream: null,
      upstreamRemote: null,
      upstreamRef: null,
      ahead: 0,
      behind: 0,
      detached: false,
      unborn: false,
    },
    operation: null,
    changes,
    commits: [],
    branches: [],
    remotes: [],
    untrackedState: "complete",
  };
}

function change(path, indexStatus = "unmodified", worktreeStatus = "modified") {
  return {
    repositoryId: ".",
    path,
    workspacePath: path,
    originalPath: null,
    indexStatus,
    worktreeStatus,
    conflicted: false,
    submodule: false,
  };
}

function diff(path, patch = `diff --git a/${path} b/${path}`) {
  return { path, headOid: "a".repeat(40), patch, binary: false, truncated: false };
}

function workingBase(path, originalPath = null) {
  return {
    path,
    originalPath,
    headOid: "a".repeat(40),
    blobOid: "b".repeat(40),
    content: `base:${path}\n`,
    utf8Bom: false,
    byteLength: path.length + 6,
  };
}

function timeoutMessages() {
  return {
    patchTruncated: "Patch truncated",
    patchTimedOut: "Patch timed out",
    unexpectedError: "Unexpected error",
  };
}

function nextTask() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
