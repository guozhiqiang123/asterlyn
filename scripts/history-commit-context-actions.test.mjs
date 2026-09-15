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

test("single top-level commit exposes only the four reviewed H1 actions", () => {
  const selected = target();
  const policy = historyCommitContextPolicy(selected, options);
  const model = historyCommitContextMenuModel(selected, policy, EN_US.history);
  assert.deepEqual(contextMenuModelErrors(model), []);
  assert.deepEqual(ids(model), [
    "git-history.commit-context-actions.copy-commit-id",
    "git-history.commit-context-actions.cherry-pick",
    "git-history.commit-context-actions.revert",
    "git-history.commit-context-actions.create-branch",
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
  assert.deepEqual(events.slice(1), [
    ["copy", selected.oid], ["status", "Full commit ID copied"],
    ["operation", "revert", selected.oid], ["branch", selected.oid],
  ]);
});
