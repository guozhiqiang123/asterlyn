import assert from "node:assert/strict";
import test from "node:test";

import {
  GitOperationController,
  operationTargets,
} from "../src/features/git-operations/git-operation-controller.ts";
import {
  renderGitOperationDialog,
} from "../src/features/git-operations/git-operation-view.ts";
import {
  renderGitOperationBanner,
} from "../src/features/git-operations/git-operation-banner.ts";

test("restart reconstruction installs one typed operation and exposes only allowed actions", () => {
  const controller = new GitOperationController(gateway());
  const operation = activeOperation();

  controller.installSnapshot(snapshot("/repo", operation));

  assert.equal(controller.state.operation, operation);
  const banner = renderGitOperationBanner(controller.state.operation);
  assert.match(banner, /Merge/);
  assert.match(banner, /data-git-operation-action="abort"/);
  assert.doesNotMatch(banner, /data-git-operation-action="continue"/);
  controller.dispose();
});

test("review binds exact ordered targets and execute closes only after success", async () => {
  const calls = [];
  const plan = reviewedPlan();
  const controller = new GitOperationController(gateway({
    async prepareGitOperation(...args) {
      calls.push(args);
      return plan;
    },
    async executeGitOperation(root, reviewed) {
      assert.equal(root, "/repo");
      assert.equal(reviewed, plan);
      return outcome(snapshot("/repo", null));
    },
  }));
  controller.installSnapshot(snapshot("/repo", null));
  controller.openSetup("cherryPick", ["one", "two"]);

  assert.equal(await controller.prepare(), true);
  assert.deepEqual(calls[0], ["/repo", "cherryPick", ["one", "two"], null]);
  assert.equal(controller.state.dialog, "review");
  assert.match(renderGitOperationDialog(controller.state), /Exact targets/);

  const result = await controller.execute();
  assert.equal(result.status, "success");
  assert.equal(controller.state.dialog, null);
  controller.dispose();
});

test("a repository replacement rejects a late reviewed plan", async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const controller = new GitOperationController(gateway({
    async prepareGitOperation() { return pending; },
  }));
  controller.installSnapshot(snapshot("/repo", null));
  controller.openSetup("merge", ["feature"]);
  const preparing = controller.prepare();

  controller.installSnapshot(snapshot("/other", null));
  finish(reviewedPlan());

  assert.equal(await preparing, false);
  assert.equal(controller.state.repositoryRoot, "/other");
  assert.equal(controller.state.dialog, null);
  controller.dispose();
});

test("conflict resolution sends the opened revision token and edited result", async () => {
  const calls = [];
  const operation = activeOperation();
  const controller = new GitOperationController(gateway({
    async readConflictContent(root, path) {
      assert.deepEqual([root, path], ["/repo", "shared.txt"]);
      return {
        path,
        base: "base\n",
        ours: "ours\n",
        theirs: "theirs\n",
        worktree: "markers\n",
        binary: false,
        revisionToken: "revision-1",
      };
    },
    async resolveConflict(...args) {
      calls.push(args);
      return operationOutcome({ ...operation, conflicts: [] });
    },
  }));
  controller.installSnapshot(snapshot("/repo", operation));

  assert.equal(await controller.openConflict("shared.txt"), true);
  controller.setConflictResult("resolved\n");
  const result = await controller.resolveConflict(false);

  assert.equal(result.status, "success");
  assert.deepEqual(calls[0], ["/repo", "shared.txt", "revision-1", "resolved\n"]);
  assert.equal(controller.state.dialog, null);
  controller.dispose();
});

test("operation target parsing preserves explicit order and removes blank lines", () => {
  assert.deepEqual(operationTargets(" first \n\nsecond\r\n third "), [
    "first",
    "second",
    "third",
  ]);
});

function gateway(overrides = {}) {
  return {
    async prepareGitOperation() { return reviewedPlan(); },
    async executeGitOperation() { return outcome(snapshot("/repo", null)); },
    async runGitOperationAction() { return outcome(snapshot("/repo", null)); },
    async readConflictContent() { throw new Error("not configured"); },
    async resolveConflict() { throw new Error("not configured"); },
    ...overrides,
  };
}

function activeOperation() {
  return {
    kind: "merge",
    phase: "conflicted",
    originalHeadOid: "a".repeat(40),
    currentHeadOid: "a".repeat(40),
    headRef: "refs/heads/main",
    targetOids: ["b".repeat(40)],
    conflicts: [{
      path: "shared.txt",
      baseOid: "c".repeat(40),
      oursOid: "d".repeat(40),
      theirsOid: "e".repeat(40),
    }],
    progress: { current: null, total: null, detail: null },
    allowedActions: ["abort"],
  };
}

function reviewedPlan() {
  return {
    kind: "cherryPick",
    repositoryRoot: "/repo",
    startHeadOid: "a".repeat(40),
    startHeadRef: "refs/heads/main",
    targetRefs: ["one", "two"],
    targetOids: ["b".repeat(40), "c".repeat(40)],
    commitCount: 2,
    summary: "Cherry-pick 2 reviewed commits",
    message: null,
    previewToken: "review-token",
  };
}

function outcome(repository) {
  return { snapshot: repository, invalidatedSlices: ["operation"] };
}

function operationOutcome(operation) {
  return {
    tracked: { root: "/repo", changes: [] },
    operation,
    invalidatedSlices: ["openDocuments", "workingTree", "operation"],
  };
}

function snapshot(root, operation) {
  return {
    root,
    gitDir: `${root}/.git`,
    repositoryRoots: [],
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
    operation,
    changes: [],
    commits: [],
    branches: [],
    remotes: [],
    untrackedState: "complete",
  };
}
