import assert from "node:assert/strict";
import test from "node:test";

import {
  ProjectFilesContextActions,
  projectFilesContextMenuModel,
} from "../src/features/files-editor/project-files-context-actions.ts";
import { EN_US } from "../src/localization/en-US.ts";
import { contextMenuModelErrors } from "../src/shared/context-menu/context-menu-model.ts";

const target = {
  workspaceRoot: "/workspace",
  workspaceGeneration: 7,
  workspacePath: "src/app.ts",
  kind: "file",
  status: "unmodified",
  readOnly: false,
  file: {
    repositoryId: ".",
    path: "src/app.ts",
    workspacePath: "src/app.ts",
    readOnly: false,
  },
};

const enabled = { kind: "enabled" };

test("Files and folder targets receive the same ordered action set", () => {
  const policy = { mutation: enabled, paste: enabled, history: enabled };
  const fileModel = projectFilesContextMenuModel(target, policy, EN_US.projectFiles);
  const folderModel = projectFilesContextMenuModel(
    { ...target, workspacePath: "src", kind: "directory", file: null },
    policy,
    EN_US.projectFiles,
  );
  const shape = (model) => model.items.map((item) =>
    item.kind === "separator" ? "separator" : [item.kind, item.id, item.label]);
  assert.deepEqual(shape(folderModel), shape(fileModel));
  assert.deepEqual(contextMenuModelErrors(fileModel), []);
  assert.equal(fileModel.items.at(-1).tone, "danger");
});

test("Files action provider owns selection, copy routing and exact target lifetime", async () => {
  let session = null;
  const events = [];
  const provider = new ProjectFilesContextActions(
    {
      open(_anchor, value) { session = value; },
      close() {},
    },
    {
      async writeText(text) {
        events.push(["clipboard", text]);
        return { status: "copied" };
      },
    },
    {
      current: (candidate) => candidate.workspaceGeneration === 7,
      select: (candidate) => { events.push(["select", candidate.workspacePath]); return true; },
      policy: () => ({ mutation: enabled, paste: enabled, history: enabled }),
      createFile: () => events.push(["new"]),
      cut: () => events.push(["cut"]),
      copy: () => events.push(["copy"]),
      paste: () => events.push(["paste"]),
      reveal: () => events.push(["reveal"]),
      rename: () => events.push(["rename"]),
      historyIntent: (candidate) => ({
        workspaceRoot: candidate.workspaceRoot,
        workspaceGeneration: candidate.workspaceGeneration,
        query: {
          repositoryIds: ["."], refs: [], authorEmails: [], currentAuthor: false,
          sinceEpoch: null, paths: [{ repositoryId: ".", path: "src/app.ts" }],
          firstParent: false, excludeMerges: false, order: "topological",
        },
      }),
      installHistoryQuery: (intent) => events.push(["history", intent.query.paths[0].path]),
      trash: () => events.push(["trash"]),
      blocked: (reason) => events.push(["blocked", reason]),
      status: (message) => events.push(["status", message]),
      error: (error) => events.push(["error", error]),
    },
    () => EN_US.projectFiles,
  );

  assert.equal(provider.open({
    target,
    anchor: { x: 1, y: 2 },
    trigger: {},
    restoreFocus() { events.push(["focus"]); },
  }), true);
  assert.equal(session.ownerId, "project-files.context-actions");
  assert.equal(session.isCurrent(), true);
  await session.invoke("project-files.context-actions.copy-relative-path");
  await session.invoke("project-files.context-actions.reveal");
  await session.invoke("project-files.context-actions.history");
  assert.deepEqual(events, [
    ["select", "src/app.ts"],
    ["clipboard", "src/app.ts"],
    ["status", "Relative path copied"],
    ["reveal"],
    ["history", "src/app.ts"],
  ]);
});

test("blocked policy stays semantic and provider does not open for a stale target", () => {
  const reason = "Read-only entries cannot be changed";
  const model = projectFilesContextMenuModel(target, {
    mutation: { kind: "blocked", reason },
    paste: { kind: "blocked", reason },
    history: { kind: "blocked", reason: "No Git history" },
  }, EN_US.projectFiles);
  assert.equal(model.items[0].availability.reason, reason);
  assert.equal(model.items[6].availability.kind, "enabled");
  assert.equal(model.items[8].availability.kind, "enabled");

  let opened = false;
  const provider = new ProjectFilesContextActions(
    { open() { opened = true; }, close() {} },
    { writeText: async () => ({ status: "copied" }) },
    {
      current: () => false, select: () => true,
      policy: () => ({ mutation: enabled, paste: enabled, history: enabled }),
      createFile() {}, cut() {}, copy() {}, paste() {}, reveal() {}, rename() {},
      historyIntent: () => null, installHistoryQuery() {}, trash() {},
      blocked() {}, status() {}, error() {},
    },
    () => EN_US.projectFiles,
  );
  assert.equal(provider.open({ target, anchor: { x: 0, y: 0 }, trigger: {}, restoreFocus() {} }), false);
  assert.equal(opened, false);
});

test("action failures are reported through the feature runtime", async () => {
  let session = null;
  const errors = [];
  const provider = new ProjectFilesContextActions(
    { open(_anchor, value) { session = value; }, close() {} },
    { writeText: async () => ({ status: "copied" }) },
    {
      current: () => true, select: () => true,
      policy: () => ({ mutation: enabled, paste: enabled, history: enabled }),
      createFile() {}, cut() {}, copy() {}, paste() {},
      async reveal() { throw new Error("reveal failed"); },
      rename() {}, historyIntent: () => null, installHistoryQuery() {}, trash() {},
      blocked() {}, status() {}, error(error) { errors.push(error.message); },
    },
    () => EN_US.projectFiles,
  );
  provider.open({ target, anchor: { x: 0, y: 0 }, trigger: {}, restoreFocus() {} });

  await session.invoke("project-files.context-actions.reveal");

  assert.deepEqual(errors, ["reveal failed"]);
});
