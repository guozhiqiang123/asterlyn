import assert from "node:assert/strict";
import test from "node:test";

import {
  HistoryCommitRangeContextActions,
  historyCommitRangeContextMenuModel,
} from "../src/features/git-history/history-range-context-actions.ts";
import { historyCommitRangePolicy } from "../src/features/git-history/history-range-context-policy.ts";
import {
  historyCommitRangeTargetIsCurrent,
  resolveHistoryCommitRangeTarget,
} from "../src/features/git-history/history-range-context.ts";
import { EN_US } from "../src/localization/en-US.ts";
import { contextMenuModelErrors } from "../src/shared/context-menu/context-menu-model.ts";

test("a direct HEAD suffix receives ordered reviewed range actions", () => {
  const selected = target([commit("new", ["middle"]), commit("middle", ["old"])]);
  const policy = historyCommitRangePolicy(selected, options([
    commit("new", ["middle"]), commit("middle", ["old"]), commit("old", []),
  ], "new"));
  assert.deepEqual(policy.oldestToNewest.map((item) => item.oid), ["middle", "new"]);
  assert.deepEqual(policy.newestToOldest.map((item) => item.oid), ["new", "middle"]);
  assert.equal(policy.squashBaseOid, "old");
  assert.equal(policy.cherryPick.kind, "enabled");
  assert.equal(policy.revert.kind, "enabled");
  assert.equal(policy.squash.kind, "enabled");
  const model = historyCommitRangeContextMenuModel(selected, policy, EN_US.history);
  assert.deepEqual(contextMenuModelErrors(model), []);
  assert.deepEqual(ids(model), [
    "git-history.range-context-actions.copy-commit-ids",
    "git-history.range-context-actions.cherry-pick",
    "git-history.range-context-actions.revert",
    "git-history.range-context-actions.squash",
  ]);
});

test("topology policy blocks cross-root, gaps, merge ranges, and non-HEAD squash", () => {
  const crossRoot = historyCommitRangePolicy(
    target([commit("a", ["b"]), commit("b", [], "nested")]),
    options([], "a"),
  );
  assert.equal(crossRoot.cherryPick.reason, EN_US.history.rangeContextMenu.sameRootRequired);

  const gap = historyCommitRangePolicy(
    target([commit("a", ["hidden"]), commit("b", ["base"])]),
    options([], "a"),
  );
  assert.equal(gap.revert.reason, EN_US.history.rangeContextMenu.linearRequired);

  const merge = historyCommitRangePolicy(
    target([commit("a", ["b", "side"]), commit("b", ["base"])]),
    options([commit("a", ["b", "side"]), commit("b", ["base"])], "a"),
  );
  assert.equal(merge.cherryPick.reason, EN_US.history.rangeContextMenu.mergeRequired);

  const middle = historyCommitRangePolicy(
    target([commit("b", ["a"]), commit("a", ["base"])]),
    options([commit("head", ["b"]), commit("b", ["a"]), commit("a", ["base"])], "head"),
  );
  assert.equal(middle.revert.kind, "enabled");
  assert.equal(middle.squash.reason, EN_US.history.rangeContextMenu.headSuffixRequired);
});

test("provider copies visible order and routes operation-specific topology order", async () => {
  const selected = target([commit("new", ["middle"]), commit("middle", ["old"])]);
  const events = [];
  let session;
  const provider = new HistoryCommitRangeContextActions(
    { open(_anchor, value) { session = value; }, close() {} },
    { async writeText(text) { events.push(["copy", text]); return { status: "copied" }; } },
    {
      current: () => true,
      policyOptions: () => options([
        commit("new", ["middle"]), commit("middle", ["old"]), commit("old", []),
      ], "new"),
      openGitOperation: (kind, values) => events.push([kind, ...values]),
      blocked: (reason) => events.push(["blocked", reason]),
      status: (message) => events.push(["status", message]),
      error: (error) => events.push(["error", error]),
    },
    () => EN_US.history,
  );
  provider.open({ target: selected, anchor: { x: 1, y: 2 }, trigger: {}, restoreFocus() {} });
  await session.invoke("git-history.range-context-actions.copy-commit-ids");
  await session.invoke("git-history.range-context-actions.cherry-pick");
  await session.invoke("git-history.range-context-actions.revert");
  await session.invoke("git-history.range-context-actions.squash");
  assert.deepEqual(events, [
    ["copy", "new\nmiddle"], ["status", "2 full commit IDs copied"],
    ["cherryPick", "middle", "new"], ["revert", "new", "middle"],
    ["squash", "old"],
  ]);
});

test("range context snapshot validates the entire logical selection", () => {
  const commits = [commit("new", ["old"]), commit("old", [])];
  const row = {
    workspaceRoot: "/repo", workspaceGeneration: 2, repositoryRevision: 3,
    historyGeneration: 4, repositoryId: ".", oid: "new", key: ".:new", commit: commits[0],
  };
  const selection = {
    scopeKey: "scope", anchorKey: ".:new", activeKey: ".:old", commits,
  };
  const range = resolveHistoryCommitRangeTarget(row, selection);
  const state = {
    history: { root: "/repo", generation: 4, commits },
  };
  assert.ok(range);
  assert.equal(historyCommitRangeTargetIsCurrent(range, selection, state, 2, 3), true);
  assert.equal(historyCommitRangeTargetIsCurrent(range, {
    ...selection, commits: [commits[0], { ...commits[1], subject: "changed" }],
  }, state, 2, 3), false);
});

function target(commits) {
  return {
    workspaceRoot: "/repo", workspaceGeneration: 2, repositoryRevision: 3,
    historyGeneration: 4, scopeKey: "scope", anchorKey: `.:${commits[0].oid}`,
    activeKey: `.:${commits.at(-1).oid}`, commits,
  };
}

function options(historyCommits, headOid) {
  return {
    busy: false, clean: true, cleanReason: "clean", localBranch: true,
    headOid, historyCommits, reasons: EN_US.history.rangeContextMenu,
  };
}

function commit(oid, parents, repositoryId = ".") {
  return {
    repositoryId, oid, shortOid: oid, parents, decorations: [], subject: oid,
    authorName: "A", authorEmail: "a@example.test", authoredAt: 1,
  };
}

function ids(model) {
  return model.items.filter((item) => item.kind !== "separator").map((item) => item.id);
}
