import assert from "node:assert/strict";
import test from "node:test";

import {
  CommitFileContextActions,
  commitFileContextMenuModel,
} from "../src/features/git-history/commit-file-context-actions.ts";
import {
  commitFileContextPolicy,
  commitFileHistoryIntent,
} from "../src/features/git-history/commit-file-context-policy.ts";
import { EN_US } from "../src/localization/en-US.ts";
import { contextMenuModelErrors } from "../src/shared/context-menu/context-menu-model.ts";

const target = {
  workspaceRoot: "/workspace",
  workspaceGeneration: 7,
  repositoryRevision: 4,
  workspacePath: "src/new.ts",
  repositoryId: ".",
  oid: "b".repeat(40),
  parentOid: "a".repeat(40),
  path: "src/new.ts",
  kind: "file",
  file: { path: "src/new.ts", originalPath: "src/old.ts", status: "renamed" },
  descendants: [],
  historyGeneration: 9,
};

test("commit file menu keeps reviewed view, restore, history, and copy groups", () => {
  const policy = commitFileContextPolicy({
    currentFileAvailable: false,
    currentFileUnavailableReason: "missing",
    restoreBlockedReason: null,
    busy: false,
    busyReason: "busy",
  });
  const model = commitFileContextMenuModel(target, policy, EN_US.history);
  assert.deepEqual(contextMenuModelErrors(model), []);
  assert.deepEqual(model.items.map((item) => item.kind === "separator" ? "separator" : item.id), [
    "git-history.commit-file-context-actions.show-diff",
    "git-history.commit-file-context-actions.open-historical",
    "git-history.commit-file-context-actions.compare-current",
    "git-history.commit-file-context-actions.open-current",
    "separator",
    "git-history.commit-file-context-actions.restore",
    "separator",
    "git-history.commit-file-context-actions.history",
    "separator",
    "git-history.commit-file-context-actions.copy-path",
  ]);
  assert.equal(model.items[2].availability.reason, "missing");
  assert.equal(model.items[3].availability.reason, "missing");
  const intent = commitFileHistoryIntent(target);
  assert.deepEqual(intent.query.startCommit, { repositoryId: ".", oid: target.oid });
  assert.deepEqual(intent.query.paths, [
    { repositoryId: ".", path: "src/new.ts" },
    { repositoryId: ".", path: "src/old.ts" },
  ]);
});

test("commit file provider invokes no action while opening and routes exact target identities", async () => {
  let session;
  const events = [];
  const provider = new CommitFileContextActions(
    { open(_anchor, value) { session = value; }, close() {} },
    { async writeText(text) { events.push(["copy", text]); return { status: "copied" }; } },
    {
      current: () => true,
      policy: () => commitFileContextPolicy({
        currentFileAvailable: true,
        currentFileUnavailableReason: "missing",
        restoreBlockedReason: null,
        busy: false,
        busyReason: "busy",
      }),
      highlight: (_target, value) => events.push(["highlight", value]),
      showDiff: (value) => events.push(["diff", value.file.path]),
      openHistorical: (value) => events.push(["historical", value.oid]),
      compareCurrent: (value) => events.push(["compare", value.workspacePath]),
      openCurrent: (value) => events.push(["current", value.repositoryId]),
      restore: (value) => events.push(["restore", value.file.status]),
      installHistoryQuery: (intent) => events.push(["history", intent.query.paths.length]),
      blocked: (reason) => events.push(["blocked", reason]),
      status: (message) => events.push(["status", message]),
      error: (error) => events.push(["error", error]),
    },
    () => EN_US.history,
  );
  assert.equal(provider.open({ target, anchor: { x: 1, y: 2 }, trigger: {}, restoreFocus() {} }), true);
  assert.deepEqual(events, [["highlight", true]]);
  session.invoke("git-history.commit-file-context-actions.show-diff");
  session.invoke("git-history.commit-file-context-actions.open-historical");
  session.invoke("git-history.commit-file-context-actions.compare-current");
  session.invoke("git-history.commit-file-context-actions.open-current");
  session.invoke("git-history.commit-file-context-actions.restore");
  session.invoke("git-history.commit-file-context-actions.history");
  await session.invoke("git-history.commit-file-context-actions.copy-relative-path");
  session.dismissed();
  assert.deepEqual(events, [
    ["highlight", true], ["diff", "src/new.ts"], ["historical", target.oid],
    ["compare", "src/new.ts"], ["current", "."], ["restore", "renamed"],
    ["history", 2], ["copy", "src/new.ts"],
    ["status", "Workspace-relative path copied"], ["highlight", false],
  ]);
});

test("restore policy gives editor safety precedence over execution", () => {
  assert.equal(commitFileContextPolicy({
    currentFileAvailable: true,
    currentFileUnavailableReason: "missing",
    restoreBlockedReason: "save first",
    busy: false,
    busyReason: "busy",
  }).restore.reason, "save first");
  assert.equal(commitFileContextPolicy({
    currentFileAvailable: true,
    currentFileUnavailableReason: "missing",
    restoreBlockedReason: "save first",
    busy: true,
    busyReason: "busy",
  }).restore.reason, "busy");
});
