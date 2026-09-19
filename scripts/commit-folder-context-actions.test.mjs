import assert from "node:assert/strict";
import test from "node:test";

import {
  CommitFolderContextActions,
  commitFolderContextMenuModel,
} from "../src/features/git-history/commit-folder-context-actions.ts";
import {
  commitFolderContextPolicy,
  commitFolderHistoryIntent,
} from "../src/features/git-history/commit-folder-context-policy.ts";
import { CommitFolderDiffController } from "../src/features/git-history/commit-folder-diff-controller.ts";
import { EN_US } from "../src/localization/en-US.ts";
import { contextMenuModelErrors } from "../src/shared/context-menu/context-menu-model.ts";

const files = [
  { path: "src/app.ts", originalPath: null, status: "modified" },
  { path: "src/nested/new.ts", originalPath: null, status: "added" },
];
const target = {
  workspaceRoot: "/workspace",
  workspaceGeneration: 7,
  repositoryRevision: 4,
  workspacePath: "src",
  repositoryId: ".",
  oid: "b".repeat(40),
  parentOid: "a".repeat(40),
  path: "src",
  kind: "directory",
  file: null,
  descendants: files,
  historyGeneration: 9,
};

test("folder menu keeps four stable read-only groups and an exact History start", () => {
  const policy = commitFolderContextPolicy(false, "missing now");
  const model = commitFolderContextMenuModel(target, policy, EN_US.history);
  assert.deepEqual(contextMenuModelErrors(model), []);
  assert.deepEqual(model.items.map((item) => item.kind === "separator" ? "separator" : item.id), [
    "git-history.commit-folder-context-actions.show-changes",
    "separator",
    "git-history.commit-folder-context-actions.reveal",
    "separator",
    "git-history.commit-folder-context-actions.history",
    "separator",
    "git-history.commit-folder-context-actions.copy-path",
  ]);
  assert.equal(model.items[2].availability.reason, "missing now");
  const intent = commitFolderHistoryIntent(target);
  assert.deepEqual(intent.query.startCommit, { repositoryId: ".", oid: target.oid });
  assert.deepEqual(intent.query.paths, [{ repositoryId: ".", path: "src" }]);
  assert.deepEqual(intent.query.refs, []);
});

test("folder provider routes immutable range actions and clears context highlight on dismissal", async () => {
  let session;
  const events = [];
  const provider = new CommitFolderContextActions(
    { open(_anchor, value) { session = value; }, close() {} },
    { async writeText(text) { events.push(["copy", text]); return { status: "copied" }; } },
    {
      current: () => true,
      policy: () => commitFolderContextPolicy(true, "missing"),
      highlight: (_target, highlighted) => events.push(["highlight", highlighted]),
      showChanges: (value) => events.push(["changes", value.descendants.length]),
      revealCurrentDirectory: (value) => events.push(["reveal", value.workspacePath]),
      installHistoryQuery: (intent) => events.push(["history", intent.query.startCommit.oid]),
      blocked: (reason) => events.push(["blocked", reason]),
      status: (message) => events.push(["status", message]),
      error: (error) => events.push(["error", error]),
    },
    () => EN_US.history,
  );
  assert.equal(provider.open({
    target, anchor: { x: 1, y: 2 }, trigger: {}, restoreFocus() {},
  }), true);
  await session.invoke("git-history.commit-folder-context-actions.copy-relative-path");
  session.invoke("git-history.commit-folder-context-actions.show-changes");
  session.invoke("git-history.commit-folder-context-actions.reveal");
  session.invoke("git-history.commit-folder-context-actions.history");
  session.dismissed();
  assert.deepEqual(events, [
    ["highlight", true],
    ["copy", "src"],
    ["status", "Workspace-relative folder path copied"],
    ["changes", 2],
    ["reveal", "src"],
    ["history", target.oid],
    ["highlight", false],
  ]);
});

test("folder Diff controller keeps the exact bounded descendants and explicit selection", () => {
  const controller = new CommitFolderDiffController();
  controller.open(target);
  assert.notEqual(controller.state.target, target);
  assert.equal(controller.state.selectedFile, null);
  assert.equal(controller.selectFile("src/nested/new.ts")?.status, "added");
  assert.equal(controller.state.selectedFile, "src/nested/new.ts");
  assert.equal(controller.selectFile("other.ts"), null);
  controller.clear();
  assert.equal(controller.state.target, null);
});
