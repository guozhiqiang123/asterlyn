import assert from "node:assert/strict";
import test from "node:test";
import { GitBranchesController } from "../src/features/git-history/git-branches-controller.ts";
import { branchKey } from "../src/features/git-history/history-identity.ts";

function branch(repositoryId, kind, fullName, current = false) {
  return {
    repositoryId,
    kind,
    fullName,
    name: fullName.split("/").at(-1),
    current,
    upstream: null,
    tracking: null,
    oid: "a".repeat(40),
    subject: fullName,
    committedAt: 1,
  };
}

function snapshot() {
  return {
    root: "/workspace",
    repositoryRoots: [
      { id: ".", relativePath: ".", displayName: "workspace" },
      { id: "module", relativePath: "module", displayName: "module" },
    ],
    branches: [
      branch(".", "local", "refs/heads/main", true),
      branch(".", "local", "refs/heads/topic"),
      branch("module", "local", "refs/heads/topic"),
      branch(".", "remote", "refs/remotes/origin/main"),
    ],
    branch: { head: "main", oid: "a".repeat(40), detached: false, upstream: null, ahead: 0, behind: 0 },
    changes: [],
    untrackedState: "complete",
  };
}

test("branch selection resolves exact keys and logical matches without owning History state", () => {
  const controller = new GitBranchesController({
    current: () => null,
    checkout: async () => {},
    create: async () => {},
  });
  const state = snapshot();
  const topic = state.branches[1];
  const key = branchKey(topic);
  const selection = controller.toggleHistoryScope(state, key, new Map());
  assert.equal(selection.kind, "select");
  assert.deepEqual(selection.branches.map((item) => item.repositoryId), [".", "module"]);
  assert.equal(controller.state.selectedBranch, null);

  const selected = new Map(selection.branches.map((item) => [branchKey(item), true]));
  assert.deepEqual(controller.toggleHistoryScope(state, key, selected), { kind: "clear" });
  assert.equal(controller.toggleHistoryScope(state, "missing", selected), null);
});

test("branch mutations revalidate kind, root, safety and current snapshot", async () => {
  let state = snapshot();
  let safe = true;
  let loading = false;
  const checkouts = [];
  const creates = [];
  const controller = new GitBranchesController({
    current: () => ({ snapshot: state, safe, loading }),
    checkout: async (target) => { checkouts.push(target.fullName); },
    create: async (name) => {
      creates.push(name);
      state = { ...state, branch: { ...state.branch, head: name } };
    },
  });
  assert.equal(await controller.checkout(branchKey(state.branches[1])), "accepted");
  assert.deepEqual(checkouts, ["refs/heads/topic"]);
  assert.equal(await controller.checkout(branchKey(state.branches[2])), "blocked");
  assert.equal(await controller.checkout(branchKey(state.branches[3])), "blocked");
  safe = false;
  assert.equal(await controller.checkout(branchKey(state.branches[1])), "blocked");
  safe = true;
  loading = true;
  assert.equal(await controller.checkout(branchKey(state.branches[1])), "blocked");

  loading = false;
  controller.setNewBranchName("  feature/context  ");
  assert.equal(await controller.create(), "accepted");
  assert.deepEqual(creates, ["feature/context"]);
  assert.equal(controller.state.newBranchName, "");
});

test("branch presentation state is feature-owned and reconciles removed refs", () => {
  const controller = new GitBranchesController({
    current: () => null,
    checkout: async () => {},
    create: async () => {},
  });
  controller.setQuery("topic");
  assert.equal(controller.toggleGroup("remote"), true);
  assert.equal(controller.toggleGroup("remote"), false);
  const state = snapshot();
  controller.setSelectedBranch(branchKey(state.branches[1]));
  assert.equal(controller.selected(state)?.name, "topic");
  assert.equal(controller.reconcile({ ...state, branches: [] }), true);
  assert.equal(controller.state.selectedBranch, null);
});
