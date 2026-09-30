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
const tag = (name = "v1.0", repositoryId = ".") => ({
  repositoryId, kind: "tag", fullName: `refs/tags/${name}`, name, current: false,
  upstream: null, tracking: null, oid: oid("d"), subject: name, committedAt: 1,
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

test("tag menu exposes detached checkout, merge, exact remote push, and local or remote deletion", async () => {
  const selectedTag = tag("release/v1");
  const currentSnapshot = snapshot([local("main", true), selectedTag]);
  currentSnapshot.remotes = [
    { name: "origin", url: "file:///origin", fetchSupported: true, pushSupported: true },
  ];
  const selectedTarget = target(selectedTag);
  const policy = branchContextPolicy(selectedTarget, currentSnapshot, options);
  const model = branchContextMenuModel(
    selectedTarget,
    policy,
    branchCopyActions(selectedTag, EN_US.history.branchContextMenu),
    EN_US.history,
    ["origin"],
  );
  assert.deepEqual(contextMenuModelErrors(model), []);
  assert.deepEqual(ids(model), [
    "git-branches.context-actions.tag-checkout",
    "git-branches.context-actions.tag-merge",
    "git-branches.context-actions.tag-push-0",
    "git-branches.context-actions.tag-delete-local",
    "git-branches.context-actions.tag-delete-remote-0",
  ]);
  assert.equal(model.items.some((item) => item.kind !== "separator" && item.label.includes("Working Tree")), false);

  const events = [];
  let session;
  const provider = new BranchContextActions(
    { open(_anchor, value) { session = value; }, close() {} },
    { async writeText() { return { status: "copied" }; } },
    {
      current: () => true,
      highlight: () => {},
      snapshot: () => currentSnapshot,
      policyOptions: () => ({ ...options }),
      showHistory: () => {},
      openMutation: () => {},
      openGitOperation: (kind, name) => events.push(["operation", kind, name]),
      openRemoteAction: () => {},
      tagRemotes: () => ["origin"],
      selectedTagRemote: () => "origin",
      tagRemoteUnavailable: () => "Select a configured remote.",
      openTagMutation: (kind, selected, remoteName) =>
        events.push(["tag", kind, selected.branch.fullName, remoteName ?? null]),
      blocked: () => {}, status: () => {}, error: () => {},
    },
    () => EN_US.history,
  );
  provider.open({ target: selectedTarget, anchor: { x: 1, y: 2 }, trigger: {}, restoreFocus() {} });
  await session.invoke("git-branches.context-actions.tag-checkout");
  await session.invoke("git-branches.context-actions.tag-merge");
  await session.invoke("git-branches.context-actions.tag-push-0");
  await session.invoke("git-branches.context-actions.tag-delete-local");
  await session.invoke("git-branches.context-actions.tag-delete-remote-0");
  assert.deepEqual(events, [
    ["tag", "checkout", selectedTag.fullName, null],
    ["operation", "merge", selectedTag.fullName],
    ["tag", "push", selectedTag.fullName, "origin"],
    ["tag", "deleteLocal", selectedTag.fullName, null],
    ["tag", "deleteRemote", selectedTag.fullName, "origin"],
  ]);
  provider.executeCommand("tag-push", selectedTarget);
  provider.executeCommand("tag-delete-remote", selectedTarget);
  assert.deepEqual(events.slice(-2), [
    ["tag", "push", selectedTag.fullName, "origin"],
    ["tag", "deleteRemote", selectedTag.fullName, "origin"],
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
      tagRemotes: () => [],
      selectedTagRemote: () => null,
      tagRemoteUnavailable: () => "Select a configured remote.",
      openTagMutation: () => {},
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

  assert.deepEqual(provider.commandAvailability("branch-merge", target(branch)), { kind: "enabled" });
  assert.equal(provider.commandAvailability("tag-checkout", target(branch)).kind, "blocked");
  provider.executeCommand("branch-merge", target(branch));
  provider.executeCommand("branch-delete", target(branch));
  assert.deepEqual(events.slice(-2), [
    ["operation", "merge", branch.fullName],
    ["mutation", "delete", branch.fullName, ""],
  ]);
});
