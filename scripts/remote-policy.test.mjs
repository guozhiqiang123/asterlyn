import assert from "node:assert/strict";
import test from "node:test";

import { preferredRemote, remotePolicy } from "../src/remote-policy.ts";

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

test("enables only clean behind-only fast-forward pull", () => {
  const policy = remotePolicy(
    snapshot({ branch: { ahead: 0, behind: 2 } }),
    "origin",
  );
  assert.equal(policy.pull.enabled, true);
  assert.equal(policy.push.enabled, true);
  assert.match(policy.push.detail, /Force Push with Lease/);

  const dirty = remotePolicy(
    snapshot({ branch: { ahead: 0, behind: 2 }, changes: [{ path: "dirty.txt" }] }),
    "origin",
  );
  assert.equal(dirty.pull.enabled, false);
});

test("reviews divergence and blocks mirror push while allowing new-branch publish", () => {
  const diverged = remotePolicy(
    snapshot({ branch: { ahead: 1, behind: 1 } }),
    "origin",
  );
  assert.equal(diverged.pull.enabled, false);
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
