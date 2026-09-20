import assert from "node:assert/strict";
import test from "node:test";

import {
  branchContextMenuModel,
  branchCopyActions,
  BranchContextActions,
} from "../src/features/git-history/branch-context-actions.ts";
import { branchContextPolicy } from "../src/features/git-history/branch-context-policy.ts";
import { EN_US } from "../src/localization/en-US.ts";
import { contextMenuModelErrors } from "../src/shared/context-menu/context-menu-model.ts";

const oid = (value) => value.repeat(40);
const local = (name, current = false, upstream = null, repositoryId = ".") => ({
  repositoryId, kind: "local", fullName: `refs/heads/${name}`, name, current, upstream,
  tracking: null, oid: oid(current ? "a" : "b"), subject: name, committedAt: 1,
});
const remote = (name = "origin/main", repositoryId = ".") => ({
  repositoryId, kind: "remote", fullName: `refs/remotes/${name}`, name, current: false,
  upstream: null, tracking: null, oid: oid("c"), subject: name, committedAt: 1,
});
const snapshot = (branches) => ({
  root: "/repo", gitDir: "/repo/.git",
  repositoryRoots: [{ id: ".", relativePath: ".", displayName: "repo", kind: "main" }],
  branch: { head: "main", oid: oid("a"), upstream: null, upstreamRemote: null, upstreamRef: null, ahead: 0, behind: 0, detached: false, unborn: false },
  operation: null, changes: [], commits: [], branches, remotes: [], untrackedState: "complete",
});
const target = (branch, matches = [branch]) => ({
  workspaceRoot: "/repo", workspaceGeneration: 2, repositoryRevision: 3,
  key: `${branch.repositoryId}:${branch.fullName}`, branch, matches,
});
const options = {
  busy: false, clean: true, cleanReason: "clean", updateBlocked: null, pushBlocked: null,
  reasons: EN_US.history.branchContextMenu,
};
const ids = (model) => model.items
  .filter((item) => item.kind !== "separator")
  .map((item) => item.id);

test("branch menu matrix keeps writes scoped to one top-level ref", () => {
  const current = local("main", true);
  const other = local("topic");
  const upstream = remote();
  for (const branch of [current, other, upstream]) {
    const currentSnapshot = snapshot([current, other, upstream]);
    const currentTarget = target(branch);
    const policy = branchContextPolicy(currentTarget, currentSnapshot, options);
    const model = branchContextMenuModel(
      currentTarget,
      policy,
      branchCopyActions(branch, EN_US.history.branchContextMenu),
      EN_US.history,
    );
    assert.deepEqual(contextMenuModelErrors(model), []);
    const menuIds = ids(model);
    if (branch === current) {
      assert.equal(menuIds.includes("git-branches.context-actions.update"), true);
      assert.equal(menuIds.includes("git-branches.context-actions.delete"), false);
      assert.equal(menuIds.includes("git-branches.context-actions.merge"), false);
    } else if (branch === other) {
      assert.equal(menuIds.includes("git-branches.context-actions.switch"), true);
      assert.equal(menuIds.includes("git-branches.context-actions.merge"), true);
      assert.equal(menuIds.includes("git-branches.context-actions.delete"), true);
    } else {
      assert.equal(menuIds.includes("git-branches.context-actions.checkout-remote"), true);
      assert.equal(menuIds.includes("git-branches.context-actions.rename"), false);
      assert.equal(menuIds.includes("git-branches.context-actions.delete"), false);
    }
  }
});

test("remote tracking relationship switches the exact local branch and logical rows stay read-only", () => {
  const upstream = remote();
  const tracking = local("main", false, upstream.fullName);
  const currentSnapshot = snapshot([tracking, upstream]);
  const policy = branchContextPolicy(target(upstream), currentSnapshot, options);
  assert.equal(policy.switchTarget.fullName, tracking.fullName);
  assert.equal(policy.remoteCheckout, false);

  const nested = local("topic", false, null, "packages/ui");
  const shared = target(nested, [nested, { ...nested, repositoryId: "packages/api" }]);
  const sharedPolicy = branchContextPolicy(shared, currentSnapshot, options);
  const model = branchContextMenuModel(
    shared,
    sharedPolicy,
    branchCopyActions(nested, EN_US.history.branchContextMenu),
    EN_US.history,
  );
  assert.deepEqual(ids(model), [
    "git-branches.context-actions.history", "git-branches.context-actions.copy",
  ]);
});

test("provider opens without executing and routes history, copy, and reviewed mutations", async () => {
  const branch = local("topic");
  const currentSnapshot = snapshot([local("main", true), branch]);
  const events = [];
  let session;
  const provider = new BranchContextActions(
    { open(_anchor, value) { session = value; }, close() {} },
    { async writeText(text) { events.push(["copy", text]); return { status: "copied" }; } },
    {
      current: () => true,
      highlight: (_target, highlighted) => events.push(["highlight", highlighted]),
      snapshot: () => currentSnapshot,
      policyOptions: () => ({ ...options }), showHistory: () => events.push(["history"]),
      openMutation: (kind, selected, name) => events.push(["mutation", kind, selected.fullName, name]),
      openGitOperation: (kind, name) => events.push(["operation", kind, name]),
      openRemoteAction: (kind) => events.push(["remote", kind]),
      blocked: (reason) => events.push(["blocked", reason]),
      status: (message) => events.push(["status", message]),
      error: (error) => events.push(["error", error]),
    },
    () => EN_US.history,
  );
  provider.open({ target: target(branch), anchor: { x: 1, y: 2 }, trigger: {}, restoreFocus() {} });
  assert.deepEqual(events, [["highlight", true]]);
  session.dismissed();
  await session.invoke("git-branches.context-actions.history");
  await session.invoke("git-branches.context-actions.copy-full");
  await session.invoke("git-branches.context-actions.merge");
  await session.invoke("git-branches.context-actions.rename");
  assert.deepEqual(events.slice(1), [
    ["highlight", false],
    ["history"], ["copy", branch.fullName], ["status", "Full branch reference copied"],
    ["operation", "merge", branch.fullName],
    ["mutation", "rename", branch.fullName, branch.name],
  ]);
});
