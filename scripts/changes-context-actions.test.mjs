import assert from "node:assert/strict";
import test from "node:test";

import {
  ChangesContextActions,
  changesContextMenuModel,
  unversionedGroupContextMenuModel,
} from "../src/features/changes-commit/changes-context-actions.ts";
import {
  changesContextPolicy,
  changesHistoryIntent,
  changesContextPolicies,
} from "../src/features/changes-commit/changes-context-policy.ts";
import { EN_US } from "../src/localization/en-US.ts";
import { contextMenuModelErrors } from "../src/shared/context-menu/context-menu-model.ts";
import { resolveChangesDirectoryContextTarget } from "../src/features/changes-commit/changes-navigation-binding.ts";

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

  const group = unversionedGroupContextMenuModel({
    workspaceRoot: "/repo", workspaceGeneration: 5, kind: "group",
    group: "unversioned", repositoryId: ".", repositoryRevision: 3,
    paths: ["new-a.txt", "new-b.txt"],
  }, { stage: enabled, trash: enabled }, EN_US.changes);
  assert.deepEqual(contextMenuModelErrors(group), []);
  assert.deepEqual(ids(group), [
    "changes.context-actions.stage-all",
    "changes.context-actions.trash-all",
  ]);
  assert.equal(group.items.at(-1).tone, "danger");
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

  const busyConflict = changesContextPolicy(target({ conflicted: true }), {
    snapshot: current, sourceAvailable: true, conflictAvailable: true,
    mutationBusy: true, trashAvailable: true, reasons: labels,
  });
  assert.equal(busyConflict.conflict.kind, "busy");
  assert.equal(busyConflict.conflict.label, labels.mutationBusy);

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
      groupPolicy: () => ({ stage: enabled, trash: enabled }),
      setIncluded: (_candidate, value) => { included = value; events.push(["include", value]); },
      showDiff: () => events.push(["diff"]), jumpToSource: () => events.push(["source"]),
      resolveConflict: () => events.push(["resolve"]), restore: () => events.push(["restore"]),
      trash: () => events.push(["trash"]),
      stageAll: () => events.push(["stage-all"]), trashAll: () => events.push(["trash-all"]),
      installHistoryQuery() {},
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

  const group = {
    workspaceRoot: "/repo", workspaceGeneration: 5, kind: "group",
    group: "unversioned", repositoryId: ".", repositoryRevision: 3,
    paths: ["new-a.txt", "new-b.txt"],
  };
  provider.open({ target: group, anchor: { x: 3, y: 4 }, trigger: {}, restoreFocus() {} });
  await session.invoke("changes.context-actions.stage-all");
  await session.invoke("changes.context-actions.trash-all");
  assert.deepEqual(events.slice(-2), [["stage-all"], ["trash-all"]]);
});

test("command routing reuses context policy and revalidates the exact target", async () => {
  const events = [];
  let current = true;
  let included = true;
  const provider = new ChangesContextActions(
    { open() {}, close() {} },
    { async writeText(text) { events.push(["copy", text]); return { status: "copied" }; } },
    {
      current: () => current,
      select: () => true,
      included: () => included,
      snapshot: () => snapshot(),
      policyOptions: () => ({
        sourceAvailable: true, conflictAvailable: false, mutationBusy: false,
        trashAvailable: true, reasons: EN_US.changes.contextMenu,
      }),
      groupPolicy: () => ({ stage: enabled, trash: enabled }),
      setIncluded: (_target, value) => { included = value; events.push(["include", value]); },
      showDiff: () => events.push(["diff"]), jumpToSource: () => events.push(["source"]),
      resolveConflict: () => events.push(["resolve"]), restore: () => events.push(["restore"]),
      trash: () => events.push(["trash"]), stageAll: () => events.push(["stage-all"]),
      trashAll: () => events.push(["trash-all"]), installHistoryQuery: () => events.push(["history"]),
      blocked: (reason) => events.push(["blocked", reason]), status: () => {},
      error: (error) => events.push(["error", error]),
    },
    () => EN_US.changes,
  );
  const ordinary = target();
  const untracked = target({ worktreeStatus: "untracked" });
  const group = {
    workspaceRoot: "/repo", workspaceGeneration: 5, kind: "group",
    group: "unversioned", repositoryId: ".", repositoryRevision: 3,
    paths: ["new-a.txt"],
  };

  assert.equal(provider.commandAvailability("trash", ordinary).kind, "blocked");
  assert.equal(provider.commandAvailability("trash", untracked).kind, "enabled");
  await provider.executeCommand("include", ordinary);
  await provider.executeCommand("source", ordinary);
  await provider.executeCommand("copy-name", ordinary);
  await provider.executeCommand("copy-relative-path", ordinary);
  await provider.executeCommand("copy-absolute-path", ordinary);
  await provider.executeCommand("stage-all", group);
  assert.deepEqual(events, [
    ["include", false], ["source"], ["copy", "app.ts"], ["copy", "src/app.ts"],
    ["copy", "/repo/src/app.ts"], ["stage-all"],
  ]);

  current = false;
  await provider.executeCommand("restore", ordinary);
  assert.deepEqual(events.at(-1), ["blocked", EN_US.changes.contextMenu.targetChanged]);
});

test("directory menu copies exact paths and requests reviewed Trash without file selection", async () => {
  const currentSnapshot = snapshot([{ ...target().change, path: ".openidea/new.txt", worktreeStatus: "untracked" }]);
  const directory = resolveChangesDirectoryContextTarget(currentSnapshot, 5, ".openidea", "unversioned", ".", 3);
  const events = [];
  let session;
  let current = true;
  let availability = enabled;
  const actions = new ChangesContextActions(
    { open(_anchor, value) { session = value; } },
    { async writeText(text) { events.push(["copy", text]); return { status: "copied" }; } },
    {
      current: () => current,
      select() { assert.fail("folder context must not change selected Diff or inclusion"); },
      groupPolicy: () => ({ stage: availability, trash: availability }),
      trash: (value) => events.push(["review-trash", value.workspacePath, value.kind]),
      blocked: (reason) => events.push(["blocked", reason]),
      status() {}, error(error) { throw error; },
    },
    () => EN_US.changes,
  );
  assert.equal(actions.open({ target: directory, anchor: { x: 1, y: 2 }, restoreFocus() {} }), true);
  assert.deepEqual(contextMenuModelErrors(session.model), []);
  assert.deepEqual(session.model.items.filter((item) => item.kind !== "separator").map((item) => item.label), ["Move to Trash…", "Copy Path"]);
  assert.deepEqual(events, []);
  for (const action of ["copy-name", "copy-relative-path", "copy-absolute-path", "trash"]) {
    await session.invoke(`changes.context-actions.${action}`);
  }
  assert.deepEqual(events, [["copy", ".openidea"], ["copy", ".openidea"], ["copy", "/repo/.openidea"], ["review-trash", ".openidea", "directory"]]);
  availability = { kind: "busy", label: "Mutation busy" };
  await session.invoke("changes.context-actions.trash");
  assert.deepEqual(events.at(-1), ["blocked", "Mutation busy"]);
  availability = { kind: "blocked", reason: "Native Trash unavailable" };
  await session.invoke("changes.context-actions.trash");
  assert.deepEqual(events.at(-1), ["blocked", "Native Trash unavailable"]);
  current = false;
  await session.invoke("changes.context-actions.copy-absolute-path");
  assert.deepEqual(events.at(-1), ["blocked", EN_US.changes.contextMenu.targetChanged]);
  assert.equal(actions.open({ target: directory }), false);
});

test("shared Changes availability keeps native restrictions and mutation busy state current", () => {
  let busy = false;
  let bulkBusy = false;
  let native = true;
  const policies = changesContextPolicies({
    snapshot: () => snapshot(), source: () => ({ readOnly: true }),
    mutationBusy: () => busy, bulkBusy: () => bulkBusy, trashAvailable: () => native,
    reasons: () => EN_US.changes.contextMenu,
  });
  assert.equal(policies.policyOptions(target()).sourceAvailable, false);
  assert.equal(policies.groupPolicy().trash.kind, "enabled");
  native = false;
  assert.equal(policies.groupPolicy().trash.kind, "blocked");
  assert.equal(policies.groupPolicy().stage.kind, "enabled");
  bulkBusy = true;
  assert.equal(policies.groupPolicy().trash.kind, "busy");
  assert.equal(policies.policyOptions(target()).mutationBusy, false);
  busy = true;
  assert.equal(policies.policyOptions(target()).mutationBusy, true);
});
