import assert from "node:assert/strict";
import test from "node:test";

import {
  preferredRemote,
  remotePolicy,
  requiresRemoteConfiguration,
} from "../src/remote-policy.ts";
import {
  branchSafety,
  prepareBranchMutation,
  recoverPendingBranchMutation,
  recoverPendingRemoteAction,
} from "../src/application/pending-untracked-action.ts";
import { DEFAULT_LOCALIZATION } from "../src/localization/localization.ts";

function snapshot(overrides = {}) {
  const { branch: branchOverrides = {}, ...snapshotOverrides } = overrides;
  return {
    root: "/repo",
    gitDir: "/repo/.git",
    branch: {
      head: "main",
      oid: "a".repeat(40),
      upstream: "origin/main",
      upstreamRemote: "origin",
      upstreamRef: "refs/heads/main",
      ahead: 1,
      behind: 0,
      detached: false,
      unborn: false,
      ...branchOverrides,
    },
    operation: null,
    changes: [],
    commits: [],
    branches: [],
    remotes: [
      { name: "origin", fetchSupported: true, pushSupported: true },
      { name: "mirror", fetchSupported: true, pushSupported: false },
    ],
    untrackedState: "complete",
    ...snapshotOverrides,
  };
}

test("chooses upstream, origin, then first configured remote", () => {
  assert.equal(preferredRemote(snapshot(), null), "origin");
  assert.equal(
    preferredRemote(
      snapshot({
        branch: { upstreamRemote: "team" },
        remotes: [{ name: "team", fetchSupported: true, pushSupported: true }],
      }),
      null,
    ),
    "team",
  );
  assert.equal(preferredRemote(snapshot(), "mirror"), "mirror");
});

test("identifies only repositories with no configured remote", () => {
  assert.equal(requiresRemoteConfiguration(snapshot({ remotes: [] })), true);
  assert.equal(requiresRemoteConfiguration(snapshot()), false);
});

test("enables fetch and ahead-only push without requiring a clean worktree", () => {
  const policy = remotePolicy(
    snapshot({
      changes: [{ path: "dirty.txt" }],
      untrackedState: "pending",
    }),
    "origin",
  );
  assert.equal(policy.fetch.enabled, true);
  assert.equal(policy.push.enabled, true);
  assert.equal(policy.pull.enabled, false);
});

test("enables clean Update for both known incoming commits and a fresh upstream check", () => {
  const policy = remotePolicy(
    snapshot({ branch: { ahead: 0, behind: 2 } }),
    "origin",
  );
  assert.equal(policy.pull.enabled, true);
  assert.equal(policy.push.enabled, true);
  assert.match(policy.push.detail, /Force Push with Lease/);

  const lastKnownCurrent = remotePolicy(
    snapshot({ branch: { ahead: 0, behind: 0 } }),
    "origin",
  );
  assert.equal(lastKnownCurrent.pull.enabled, true);
  assert.match(lastKnownCurrent.pull.detail, /determine whether/);

  const dirty = remotePolicy(
    snapshot({ branch: { ahead: 0, behind: 2 }, changes: [{ path: "dirty.txt" }] }),
    "origin",
  );
  assert.equal(dirty.pull.enabled, false);
});

test("top-level mutations ignore only unstaged submodule worktree state", async () => {
  const selected = {
    repositoryId: ".", kind: "local", fullName: "refs/heads/topic", name: "topic",
    current: false, upstream: null, tracking: null, oid: "b".repeat(40),
    subject: "topic", committedAt: 1,
  };
  const submoduleWorktree = {
    path: "vaLib", originalPath: null,
    indexStatus: "unmodified", worktreeStatus: "modified",
    conflicted: false, submodule: true,
  };
  const repository = snapshot({
    branch: { ahead: 0, behind: 1 },
    branches: [selected],
    changes: [submoduleWorktree],
  });
  const session = {
    generation: 23,
    repository: { state: { snapshot: repository } },
    async ensureUntrackedScan() {},
    matches() { return true; },
  };

  assert.equal(branchSafety(repository, DEFAULT_LOCALIZATION).ready, true);
  assert.equal(remotePolicy(repository, "origin").pull.enabled, true);
  assert.deepEqual(await prepareBranchMutation(session, "switch", selected), {
    kind: "ready", root: "/repo", branch: selected,
  });

  repository.changes = [{ ...submoduleWorktree, indexStatus: "modified", worktreeStatus: "unmodified" }];
  assert.deepEqual(branchSafety(repository, DEFAULT_LOCALIZATION), {
    ready: false,
    message: "1 changed path blocks branch mutation. Commit, stash, or remove the changes first.",
    blockers: ["vaLib"],
  });
  assert.equal(remotePolicy(repository, "origin").pull.enabled, false);
  assert.equal((await prepareBranchMutation(session, "switch", selected)).kind, "blocked");
});

test("reviews divergence and blocks mirror push while allowing new-branch publish", () => {
  const diverged = remotePolicy(
    snapshot({ branch: { ahead: 1, behind: 1 } }),
    "origin",
  );
  assert.equal(diverged.pull.enabled, true);
  assert.match(diverged.pull.detail, /Review Merge or Rebase/);
  assert.equal(diverged.push.enabled, true);
  assert.match(diverged.push.detail, /Ordinary Push will remain blocked/);

  const unpublished = snapshot({
    branch: { upstream: null, upstreamRemote: null, upstreamRef: null, ahead: 0 },
  });
  assert.equal(remotePolicy(unpublished, "origin").push.label, "Publish branch");
  assert.equal(remotePolicy(unpublished, "origin").push.enabled, true);
  assert.equal(remotePolicy(unpublished, "mirror").push.enabled, false);
});

test("the selected remote governs every current-branch toolbar action", () => {
  const repository = snapshot({
    remotes: [
      { name: "origin", fetchSupported: true, pushSupported: true },
      { name: "team", fetchSupported: true, pushSupported: true },
    ],
  });
  const mismatched = remotePolicy(repository, "team");
  assert.equal(mismatched.fetch.enabled, true);
  assert.equal(
    mismatched.fetch.detail,
    "Refresh all standard branch-tracking refs from team.",
  );
  assert.equal(mismatched.pull.enabled, false);
  assert.match(mismatched.pull.detail, /Select origin/);
  assert.equal(mismatched.push.enabled, true);
  assert.match(mismatched.push.detail, /same-named branch on team/);
  assert.match(mismatched.push.detail, /keeps origin/);
});

test("Update completes a pending worktree scan in the same activation", async () => {
  const repository = snapshot({ untrackedState: "pending" });
  let scans = 0;
  const session = {
    generation: 7,
    repository: { state: { snapshot: repository } },
    async ensureUntrackedScan(root, generation, announce, cause) {
      scans += 1;
      assert.deepEqual([root, generation, announce, cause], [
        "/repo", 7, true, "manualRefresh",
      ]);
      repository.untrackedState = "complete";
    },
    matches(generation, root) { return generation === 7 && root === "/repo"; },
  };

  assert.equal(
    await recoverPendingRemoteAction(
      "pull", session, "origin", DEFAULT_LOCALIZATION, false,
    ),
    true,
  );
  assert.equal(scans, 1);
  assert.equal(repository.untrackedState, "complete");
});

test("branch mutation completes a pending worktree scan before continuing", async () => {
  const repository = snapshot({ untrackedState: "pending" });
  let scans = 0;
  const session = {
    generation: 11,
    repository: { state: { snapshot: repository } },
    async ensureUntrackedScan(root, generation, announce, cause) {
      scans += 1;
      assert.deepEqual([root, generation, announce, cause], [
        "/repo", 11, true, "manualRefresh",
      ]);
      repository.untrackedState = "complete";
    },
    matches(generation, root) { return generation === 11 && root === "/repo"; },
  };

  assert.equal(await recoverPendingBranchMutation(session), true);
  assert.equal(scans, 1);
});

test("branch mutation stops when the pending worktree scan fails", async () => {
  const repository = snapshot({ untrackedState: "pending" });
  const session = {
    generation: 13,
    repository: { state: { snapshot: repository } },
    async ensureUntrackedScan() { repository.untrackedState = "failed"; },
    matches() { return true; },
  };

  assert.equal(await recoverPendingBranchMutation(session), false);
});

test("branch mutation preparation resumes the scan and re-resolves the selected branch", async () => {
  const selected = {
    repositoryId: ".", kind: "local", fullName: "refs/heads/topic", name: "topic",
    current: false, upstream: null, tracking: null, oid: "b".repeat(40),
    subject: "old", committedAt: 1,
  };
  const refreshed = { ...selected, oid: "c".repeat(40), subject: "refreshed" };
  const repository = snapshot({ branches: [selected], untrackedState: "pending" });
  const session = {
    generation: 17,
    repository: { state: { snapshot: repository } },
    async ensureUntrackedScan() {
      repository.branches = [refreshed];
      repository.untrackedState = "complete";
    },
    matches() { return true; },
  };

  assert.deepEqual(await prepareBranchMutation(session, "switch", selected), {
    kind: "ready", root: "/repo", branch: refreshed,
  });
});

test("non-scan blockers and Push do not start worktree discovery", async () => {
  const repository = snapshot({
    untrackedState: "pending",
    branch: { upstream: null, upstreamRemote: null, upstreamRef: null },
  });
  let scans = 0;
  const session = {
    generation: 3,
    repository: { state: { snapshot: repository } },
    async ensureUntrackedScan() { scans += 1; },
    matches() { return true; },
  };

  assert.equal(
    await recoverPendingRemoteAction(
      "pull", session, "origin", DEFAULT_LOCALIZATION, false,
    ),
    true,
  );
  assert.equal(
    await recoverPendingRemoteAction(
      "push", session, "origin", DEFAULT_LOCALIZATION, false,
    ),
    true,
  );
  assert.equal(scans, 0);
});
