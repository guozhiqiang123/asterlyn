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
  assert.equal(policy.push.enabled, false);

  const dirty = remotePolicy(
    snapshot({ branch: { ahead: 0, behind: 2 }, changes: [{ path: "dirty.txt" }] }),
    "origin",
  );
  assert.equal(dirty.pull.enabled, false);
});

test("blocks divergence and mirror push while allowing new-branch publish", () => {
  const diverged = remotePolicy(
    snapshot({ branch: { ahead: 1, behind: 1 } }),
    "origin",
  );
  assert.equal(diverged.pull.enabled, false);
  assert.equal(diverged.push.enabled, false);

  const unpublished = snapshot({
    branch: { upstream: null, upstreamRemote: null, upstreamRef: null, ahead: 0 },
  });
  assert.equal(remotePolicy(unpublished, "origin").push.label, "Publish branch");
  assert.equal(remotePolicy(unpublished, "origin").push.enabled, true);
  assert.equal(remotePolicy(unpublished, "mirror").push.enabled, false);
});
