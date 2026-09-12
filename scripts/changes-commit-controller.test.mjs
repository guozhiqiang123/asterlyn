import assert from "node:assert/strict";
import test from "node:test";

import { ChangesCommitController } from "../src/features/changes-commit/changes-commit-controller.ts";

test("snapshot reconciliation retains valid inclusion and selection identities", () => {
  const controller = new ChangesCommitController(gateway());
  controller.installSnapshot(snapshot([change("a.txt"), change("b.txt")]));
  controller.setPathsIncluded(["b.txt"], false);
  controller.selectChange("a.txt");

  controller.installSnapshot(snapshot([change("b.txt"), change("c.txt")]));
  assert.equal(controller.state.selectedChange?.path, "b.txt");
  assert.deepEqual([...controller.state.excludedPaths], ["b.txt"]);
  assert.deepEqual(controller.includedChanges().map(({ path }) => path), ["c.txt"]);
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
  assert.equal(controller.state.workingPatchLoading, false);
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
  controller.setPathsIncluded(["b.txt"], false);
  controller.setCommitMessage("  focused commit  ");

  const result = await controller.commit();
  assert.equal(result.status, "success");
  assert.deepEqual(committed, [{ message: "focused commit", paths: ["a.txt"] }]);
  assert.equal(controller.state.commitMessage, "");
});

test("repository replacement invalidates an in-flight revert", async () => {
  const reverted = deferred();
  const controller = new ChangesCommitController(gateway({ revertResponse: reverted.promise }));
  controller.installSnapshot(snapshot([change("a.txt")]));
  const result = controller.revertSelected();
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
    async readLocalImageDiff(_root, selected) {
      return { path: selected.path, before: null, after: null };
    },
    revertChanges() {
      return overrides.revertResponse ?? Promise.resolve(snapshot([]));
    },
    async commitChanges() {
      return { oid: "new", snapshot: snapshot([]), refreshError: null, verificationWarning: null };
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

function change(path) {
  return {
    path,
    originalPath: null,
    indexStatus: "unmodified",
    worktreeStatus: "modified",
    conflicted: false,
    submodule: false,
  };
}

function diff(path) {
  return { path, patch: `diff --git a/${path} b/${path}`, binary: false, truncated: false };
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
