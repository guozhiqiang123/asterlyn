import assert from "node:assert/strict";
import test from "node:test";

import {
  HistoryCommitContextActions,
  historyCommitContextMenuModel,
} from "../src/features/git-history/history-commit-context-actions.ts";
import { historyCommitContextPolicy } from "../src/features/git-history/history-commit-context-policy.ts";
import { EN_US } from "../src/localization/en-US.ts";
import { contextMenuModelErrors } from "../src/shared/context-menu/context-menu-model.ts";

const commit = (repositoryId = ".", parents = ["a".repeat(40)]) => ({
  repositoryId, oid: "b".repeat(40), shortOid: "bbbbbbbb", parents,
  authorName: "A", authorEmail: "a@example.test", authoredAt: 1,
  decorations: [], subject: "feat: context actions",
});
const target = (value = commit()) => ({
  workspaceRoot: "/repo", workspaceGeneration: 2, repositoryRevision: 3,
  repositoryId: value.repositoryId, oid: value.oid, historyGeneration: 4,
  key: `${value.repositoryId}:${value.oid}`, commit: value,
});
const options = {
  busy: false, clean: true, cleanReason: "clean", localBranch: true,
  reasons: EN_US.history.commitContextMenu,
};
const ids = (model) => model.items
  .filter((item) => item.kind !== "separator")
  .map((item) => item.id);

test("single top-level commit exposes reviewed commit and tag creation actions", () => {
  const selected = target();
  const policy = historyCommitContextPolicy(selected, options);
  const model = historyCommitContextMenuModel(selected, policy, EN_US.history);
  assert.deepEqual(contextMenuModelErrors(model), []);
  assert.deepEqual(ids(model), [
    "git-history.commit-context-actions.copy-commit-id",
    "git-history.commit-context-actions.cherry-pick",
    "git-history.commit-context-actions.revert",
    "git-history.commit-context-actions.create-branch",
    "git-history.commit-context-actions.new-tag",
  ]);
});

test("every tag on a commit has local and per-remote deletion actions", () => {
  const selected = target({ ...commit(), decorations: ["tag: v2", "HEAD -> main", "tag: v1"] });
  const policy = historyCommitContextPolicy(selected, options);
  const model = historyCommitContextMenuModel(selected, policy, EN_US.history, ["origin", "backup"]);
  assert.deepEqual(contextMenuModelErrors(model), []);
  const tagMenus = model.items.filter((item) => item.kind === "submenu");
  assert.deepEqual(tagMenus.map((item) => item.label), ["Tag v1", "Tag v2"]);
  assert.deepEqual(tagMenus[0].children.map((item) => [item.label, item.tone]), [
    ["Delete Local Tag…", "danger"],
    ["Delete from origin…", "danger"],
    ["Delete from backup…", "danger"],
  ]);
});

test("merge commits explain mainline limits and nested commits remain copy-only", () => {
  const merge = target(commit(".", ["a".repeat(40), "c".repeat(40)]));
  const mergePolicy = historyCommitContextPolicy(merge, options);
  assert.equal(mergePolicy.cherryPick.kind, "blocked");
  assert.equal(mergePolicy.revert.reason, EN_US.history.commitContextMenu.mergeMainlineRequired);
  assert.equal(mergePolicy.create.kind, "enabled");

  const nested = target(commit("packages/ui"));
  const nestedPolicy = historyCommitContextPolicy(nested, options);
  const model = historyCommitContextMenuModel(nested, nestedPolicy, EN_US.history);
  assert.deepEqual(contextMenuModelErrors(model), []);
  assert.deepEqual(ids(model), ["git-history.commit-context-actions.copy-commit-id"]);
});

test("Reset to Here appears only for a non-HEAD commit reachable from the current branch", () => {
  const selected = target();
  const head = { ...commit(), oid: "c".repeat(40), shortOid: "cccccccc", parents: [selected.oid] };
  const policy = historyCommitContextPolicy(selected, {
    ...options, headOid: head.oid, historyCommits: [head, selected.commit],
  });
  const model = historyCommitContextMenuModel(selected, policy, EN_US.history);
  assert.ok(ids(model).includes("git-history.commit-context-actions.reset"));
  assert.equal(historyCommitContextPolicy(target(head), {
    ...options, headOid: head.oid, historyCommits: [head, selected.commit],
  }).reset, null);
});

test("provider selects without executing and routes exact IDs into existing review flows", async () => {
  const selected = target();
  const events = [];
  let session;
  const provider = new HistoryCommitContextActions(
    { open(_anchor, value) { session = value; }, close() {} },
    { async writeText(text) { events.push(["copy", text]); return { status: "copied" }; } },
    {
      current: () => true, select: () => { events.push(["select"]); return true; },
      policyOptions: () => ({ ...options }),
      openGitOperation: (kind, oid) => events.push(["operation", kind, oid]),
      openBranchFromCommit: (value) => events.push(["branch", value.oid]),
      tagRemotes: () => ["origin"],
      openTagMutation: (kind, value, tagName, remote) =>
        events.push(["tag", kind, value.oid, tagName, remote]),
      openReset: (value) => events.push(["reset", value.oid]),
      blocked: (reason) => events.push(["blocked", reason]),
      status: (message) => events.push(["status", message]),
      error: (error) => events.push(["error", error]),
    },
    () => EN_US.history,
  );
  provider.open({ target: selected, anchor: { x: 1, y: 2 }, trigger: {}, restoreFocus() {} });
  assert.deepEqual(events, [["select"]]);
  await session.invoke("git-history.commit-context-actions.copy-commit-id");
  await session.invoke("git-history.commit-context-actions.revert");
  await session.invoke("git-history.commit-context-actions.create-branch");
  await session.invoke("git-history.commit-context-actions.new-tag");
  assert.deepEqual(events.slice(1), [
    ["copy", selected.oid], ["status", "Full commit ID copied"],
    ["operation", "revert", selected.oid], ["branch", selected.oid],
    ["tag", "create", selected.oid, undefined, undefined],
  ]);
});

test("provider routes each tagged commit submenu action to its exact tag and remote", async () => {
  const selected = target({ ...commit(), decorations: ["tag: v1"] });
  const events = [];
  let session;
  const provider = new HistoryCommitContextActions(
    { open(_anchor, value) { session = value; }, close() {} },
    { async writeText() { return { status: "copied" }; } },
    {
      current: () => true, select: () => true, policyOptions: () => ({ ...options }),
      openGitOperation() {}, openBranchFromCommit() {}, openReset() {},
      tagRemotes: () => ["origin"],
      openTagMutation: (kind, _value, tagName, remote) => events.push([kind, tagName, remote]),
      blocked() {}, status() {}, error() {},
    },
    () => EN_US.history,
  );
  provider.open({ target: selected, anchor: { x: 1, y: 2 }, trigger: {}, restoreFocus() {} });
  await session.invoke("git-history.commit-context-actions.tag-0.delete-local");
  await session.invoke("git-history.commit-context-actions.tag-0.delete-remote-0");
  assert.deepEqual(events, [["deleteLocal", "v1", null], ["deleteRemote", "v1", "origin"]]);
});
