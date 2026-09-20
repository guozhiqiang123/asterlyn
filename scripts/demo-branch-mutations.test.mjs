import assert from "node:assert/strict";
import test from "node:test";

import {
  demoExecuteBranchMutation,
  demoPrepareBranchMutation,
  demoSnapshot,
} from "../src/demo.ts";

function cleanSnapshot() {
  const snapshot = structuredClone(demoSnapshot);
  snapshot.changes = [];
  snapshot.untrackedState = "complete";
  return snapshot;
}

test("reviewed demo branch creation starts at the selected object and remains lease-bound", () => {
  const snapshot = cleanSnapshot();
  const source = snapshot.branches.find((branch) => branch.fullName === "refs/heads/main");
  const plan = demoPrepareBranchMutation(snapshot, {
    kind: "create", sourceFullName: source.fullName, sourceOid: source.oid,
    newName: "feature/reviewed", deleteRemote: false,
  });
  const next = demoExecuteBranchMutation(snapshot, plan);
  assert.equal(next.branch.head, "feature/reviewed");
  assert.equal(next.branch.oid, source.oid);
  assert.equal(next.branch.upstream, null);

  const moved = structuredClone(snapshot);
  moved.branches.find((branch) => branch.fullName === source.fullName).oid = "f".repeat(40);
  assert.throws(() => demoExecuteBranchMutation(moved, plan), /changed|stale/i);
});

test("remote checkout sets upstream while rename and delete affect local refs only", () => {
  const snapshot = cleanSnapshot();
  const remote = snapshot.branches.find((branch) => branch.fullName === "refs/remotes/origin/main");
  const checkout = demoPrepareBranchMutation(snapshot, {
    kind: "checkoutRemote", sourceFullName: remote.fullName, sourceOid: remote.oid,
    newName: "review-main", deleteRemote: false,
  });
  const checkedOut = demoExecuteBranchMutation(snapshot, checkout);
  assert.equal(checkedOut.branch.upstream, "origin/main");

  const rename = demoPrepareBranchMutation(checkedOut, {
    kind: "rename", sourceFullName: "refs/heads/main",
    sourceOid: checkedOut.branches.find((branch) => branch.fullName === "refs/heads/main").oid,
    newName: "main-renamed", deleteRemote: false,
  });
  const renamed = demoExecuteBranchMutation(checkedOut, rename);
  assert.ok(renamed.branches.some((branch) => branch.fullName === "refs/heads/main-renamed"));
  assert.ok(renamed.branches.some((branch) => branch.fullName === remote.fullName));

  const local = renamed.branches.find((branch) => branch.fullName === "refs/heads/main-renamed");
  const deletion = demoPrepareBranchMutation(renamed, {
    kind: "delete", sourceFullName: local.fullName, sourceOid: local.oid,
    newName: null, deleteRemote: false,
  });
  const deleted = demoExecuteBranchMutation(renamed, deletion);
  assert.ok(!deleted.branches.some((branch) => branch.fullName === local.fullName));
  assert.ok(deleted.branches.some((branch) => branch.fullName === remote.fullName));

  const remoteDeletion = demoPrepareBranchMutation(renamed, {
    kind: "delete", sourceFullName: local.fullName, sourceOid: local.oid,
    newName: null, deleteRemote: true,
  });
  assert.equal(remoteDeletion.remoteDeletion.remote, "origin");
  const deletedEverywhere = demoExecuteBranchMutation(renamed, remoteDeletion);
  assert.ok(!deletedEverywhere.branches.some((branch) => branch.fullName === local.fullName));
  assert.ok(!deletedEverywhere.branches.some((branch) => branch.fullName === remote.fullName));
});
