import assert from "node:assert/strict";
import test from "node:test";

import {
  ProjectFilesContextActions,
  projectFilesContextMenuModel,
} from "../src/features/files-editor/project-files-context-actions.ts";
import { projectFilesContextPolicy } from "../src/features/files-editor/project-files-context-policy.ts";
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
  const policy = { create: enabled, mutation: enabled, paste: enabled, history: enabled };
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

test("Git-ignored files and folders remain writable Files targets", () => {
  const reasons = {
    readOnly: "read only",
    mutationBusy: "busy",
    operationsUnavailable: "unavailable",
    rootUnavailable: "root",
    clipboardEmpty: "clipboard",
    gitUnavailable: "git",
    noHistory: "history",
    ambiguousHistory: "ambiguous",
  };
  for (const ignored of [
    {
      ...target,
      workspacePath: "ignored.txt",
      status: "ignored",
      file: { ...target.file, path: "ignored.txt", workspacePath: "ignored.txt", ignored: true },
    },
    {
      ...target,
      workspacePath: "ignored-dir",
      kind: "directory",
      status: "ignored",
      file: null,
    },
  ]) {
    const policy = projectFilesContextPolicy(ignored, {
      mutationBusy: false,
      mutationAvailable: true,
      clipboardAvailable: false,
      snapshot: null,
      files: [],
      reasons,
    });
    assert.equal(policy.mutation.kind, "enabled");
    const trash = projectFilesContextMenuModel(ignored, policy, EN_US.projectFiles)
      .items.find((item) => item.id === "project-files.context-actions.trash");
    assert.equal(trash.availability.kind, "enabled");
  }
});

test("the workspace root receives the folder menu with root-safe availability and copy text", async () => {
  const root = { ...target, workspacePath: "", kind: "directory", file: null };
  const reason = "The project root cannot be moved, renamed, or deleted here";
  const policy = {
    create: enabled, mutation: { kind: "blocked", reason }, paste: enabled, history: enabled,
  };
  const model = projectFilesContextMenuModel(root, policy, EN_US.projectFiles);
  const shape = (candidate) => candidate.items.map((item) =>
    item.kind === "separator" ? "separator" : [item.kind, item.id, item.label]);
  assert.deepEqual(shape(model), shape(projectFilesContextMenuModel(
    { ...target, kind: "directory" }, policy, EN_US.projectFiles,
  )));
  assert.equal(model.items[0].availability.kind, "enabled");
  assert.deepEqual(model.items[2].availability, { kind: "blocked", reason });
  assert.deepEqual(model.items[3].availability, { kind: "blocked", reason });
  assert.equal(model.items[4].availability.kind, "enabled");
  assert.equal(model.ariaLabel, "File actions for .");

  let session = null;
  const copied = [];
  const provider = new ProjectFilesContextActions(
    { open(_anchor, value) { session = value; }, close() {} },
    {
      async writeText(text) {
        copied.push(text);
        return { status: "copied" };
      },
    },
    {
      current: () => true, select: () => true,
      policy: () => policy,
      createFile() {}, cut() {}, copy() {}, paste() {}, reveal() {}, rename() {},
      historyIntent: () => null, installHistoryQuery() {}, trash() {},
      blocked() {}, status() {}, error() {},
    },
    () => EN_US.projectFiles,
  );
  assert.equal(provider.open({
    target: root, anchor: { x: 0, y: 0 }, trigger: {}, restoreFocus() {},
  }), true);
  await session.invoke("project-files.context-actions.copy-name");
  await session.invoke("project-files.context-actions.copy-relative-path");
  await session.invoke("project-files.context-actions.copy-absolute-path");
  assert.deepEqual(copied, ["workspace", ".", "/workspace"]);
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
      policy: () => ({ create: enabled, mutation: enabled, paste: enabled, history: enabled }),
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
    create: { kind: "blocked", reason },
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
      policy: () => ({ create: enabled, mutation: enabled, paste: enabled, history: enabled }),
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
      policy: () => ({ create: enabled, mutation: enabled, paste: enabled, history: enabled }),
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

test("multi-selection disables single-only actions and formats copy paths with newlines", async () => {
  const multiTarget = {
    ...target,
    selectedTargets: [
      { ...target, workspacePath: "src/a.ts" },
      { ...target, workspacePath: "src/b.ts" },
    ],
  };
  const policy = { create: enabled, mutation: enabled, paste: enabled, history: enabled };
  const model = projectFilesContextMenuModel(multiTarget, policy, EN_US.projectFiles);

  const singleOnlyIds = [
    "project-files.context-actions.new-file",
    "project-files.context-actions.cut",
    "project-files.context-actions.copy",
    "project-files.context-actions.paste",
    "project-files.context-actions.rename",
    "project-files.context-actions.history",
  ];
  for (const id of singleOnlyIds) {
    const item = model.items.find((i) => i.id === id);
    assert.ok(item, `Action ${id} should exist`);
    assert.equal(item.availability.kind, "blocked");
    assert.equal(item.availability.reason, EN_US.projectFiles.contextMenu.multipleSelected);
  }

  const trashItem = model.items.find((i) => i.id === "project-files.context-actions.trash");
  assert.equal(trashItem.availability.kind, "enabled");
  assert.equal(trashItem.tone, "danger");

  const revealItem = model.items.find((i) => i.id === "project-files.context-actions.reveal");
  assert.equal(revealItem.availability.kind, "enabled");

  let session = null;
  const copied = [];
  const revealed = [];
  const provider = new ProjectFilesContextActions(
    { open(_anchor, value) { session = value; }, close() {} },
    {
      async writeText(text) {
        copied.push(text);
        return { status: "copied" };
      },
    },
    {
      current: () => true,
      select: () => true,
      policy: () => policy,
      createFile() {}, cut() {}, copy() {}, paste() {},
      reveal: (t) => { revealed.push(t.workspacePath); },
      rename() {}, historyIntent: () => null, installHistoryQuery() {}, trash() {},
      blocked() {}, status() {}, error() {},
    },
    () => EN_US.projectFiles,
  );

  assert.equal(provider.open({
    target: multiTarget, anchor: { x: 0, y: 0 }, trigger: {}, restoreFocus() {},
  }), true);

  await session.invoke("project-files.context-actions.copy-name");
  await session.invoke("project-files.context-actions.copy-relative-path");
  await session.invoke("project-files.context-actions.copy-absolute-path");
  assert.deepEqual(copied, [
    "a.ts\nb.ts",
    "src/a.ts\nsrc/b.ts",
    "/workspace/src/a.ts\n/workspace/src/b.ts",
  ]);

  await session.invoke("project-files.context-actions.reveal");
  assert.deepEqual(revealed, ["src/a.ts", "src/b.ts"]);
});
