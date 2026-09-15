import assert from "node:assert/strict";
import test from "node:test";

import {
  ChangesContextActions,
  changesContextMenuModel,
} from "../src/features/changes-commit/changes-context-actions.ts";
import {
  changesContextPolicy,
  changesHistoryIntent,
} from "../src/features/changes-commit/changes-context-policy.ts";
import { EN_US } from "../src/localization/en-US.ts";
import { contextMenuModelErrors } from "../src/shared/context-menu/context-menu-model.ts";

const enabled = { kind: "enabled" };
const policy = {
  include: enabled, source: enabled, conflict: enabled, restore: enabled,
  trash: enabled, history: enabled,
};

function target(change = {}) {
  return {
    workspaceRoot: "/repo", workspaceGeneration: 5, workspacePath: "src/app.ts",
    kind: "file", repositoryId: ".", repositoryRevision: 3, path: "src/app.ts",
    change: {
      path: "src/app.ts", originalPath: null, indexStatus: "unmodified",
      worktreeStatus: "modified", conflicted: false, submodule: false, ...change,
    },
  };
}

function snapshot(changes = [target().change]) {
  return {
    root: "/repo", gitDir: "/repo/.git",
    repositoryRoots: [{ id: ".", relativePath: ".", displayName: "repo", kind: "main" }],
    branch: {
      head: "main", oid: "a".repeat(40), upstream: null, upstreamRemote: null,
      upstreamRef: null, ahead: 0, behind: 0, detached: false, unborn: false,
    },
    operation: null, changes, commits: [], branches: [], remotes: [], untrackedState: "complete",
  };
}

test("Changes menu keeps stable groups and only adds conditional conflict/Trash actions", () => {
  const ordinary = changesContextMenuModel(target(), true, policy, EN_US.changes);
  const conflict = changesContextMenuModel(target({ conflicted: true }), true, policy, EN_US.changes);
  const untracked = changesContextMenuModel(
    target({ worktreeStatus: "untracked" }), true, policy, EN_US.changes,
  );
  const ids = (model) => model.items.filter((item) => item.kind !== "separator").map((item) => item.id);

  assert.deepEqual(contextMenuModelErrors(ordinary), []);
  assert.equal(ordinary.items[0].kind, "check");
  assert.equal(ordinary.items[0].checked, true);
  assert.equal(ids(ordinary).includes("changes.context-actions.resolve"), false);
  assert.equal(ids(conflict).includes("changes.context-actions.resolve"), true);
  assert.equal(ids(untracked).includes("changes.context-actions.trash"), true);
  assert.equal(untracked.items.find((item) => item.id === "changes.context-actions.trash").tone, "danger");
});

test("policy explains conflicts, deleted sources, restore limits, demo Trash and new-file history", () => {
  const labels = EN_US.changes.contextMenu;
  const current = snapshot();
  const result = changesContextPolicy(target({
    conflicted: true, worktreeStatus: "deleted", submodule: true,
  }), {
    snapshot: current, sourceAvailable: false, conflictAvailable: false,
    mutationBusy: false, trashAvailable: false, reasons: labels,
  });
  assert.equal(result.include.kind, "blocked");
  assert.equal(result.source.reason, labels.sourceDeleted);
  assert.equal(result.conflict.reason, labels.conflictUnavailable);
  assert.equal(result.restore.reason, labels.restoreUnavailable);

  const untracked = target({ worktreeStatus: "untracked" });
  assert.equal(changesHistoryIntent(untracked, snapshot([untracked.change])), null);
  assert.equal(changesContextPolicy(untracked, {
    snapshot: snapshot([untracked.change]), sourceAvailable: true, conflictAvailable: false,
    mutationBusy: false, trashAvailable: false, reasons: labels,
  }).trash.reason, labels.operationsUnavailable);
});

test("renamed history queries both exact names and action routing never opens Diff on menu open", async () => {
  const renamed = target({ originalPath: "src/old.ts", indexStatus: "renamed" });
  assert.deepEqual(changesHistoryIntent(renamed, snapshot([renamed.change])).query.paths, [
    { repositoryId: ".", path: "src/app.ts" },
    { repositoryId: ".", path: "src/old.ts" },
  ]);

  let session;
  const events = [];
  let included = true;
  const provider = new ChangesContextActions(
    { open(_anchor, value) { session = value; }, close() {} },
    { async writeText(text) { events.push(["copy", text]); return { status: "copied" }; } },
    {
      current: () => true,
      select: (candidate) => { events.push(["select", candidate.path]); return true; },
      included: () => included,
      snapshot: () => snapshot([renamed.change]),
      policyOptions: () => ({
        sourceAvailable: true, conflictAvailable: false, mutationBusy: false,
        trashAvailable: true, reasons: EN_US.changes.contextMenu,
      }),
      setIncluded: (_candidate, value) => { included = value; events.push(["include", value]); },
      showDiff: () => events.push(["diff"]), jumpToSource: () => events.push(["source"]),
      resolveConflict: () => events.push(["resolve"]), restore: () => events.push(["restore"]),
      trash: () => events.push(["trash"]), installHistoryQuery() {},
      blocked: (reason) => events.push(["blocked", reason]),
      status: (message) => events.push(["status", message]), error: (error) => events.push(["error", error]),
    },
    () => EN_US.changes,
  );

  provider.open({ target: renamed, anchor: { x: 1, y: 2 }, trigger: {}, restoreFocus() {} });
  assert.deepEqual(events, [["select", "src/app.ts"]]);
  await session.invoke("changes.context-actions.include");
  await session.invoke("changes.context-actions.diff");
  await session.invoke("changes.context-actions.copy-relative-path");
  assert.deepEqual(events, [
    ["select", "src/app.ts"], ["include", false], ["status", "Excluded from commit"],
    ["diff"], ["copy", "src/app.ts"], ["status", "Relative path copied"],
  ]);
});
