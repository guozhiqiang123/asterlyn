import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceReplacementController } from "../src/features/files-editor/workspace-replacement-controller.ts";

test("replacement controller owns preview identity, selection, and dialog state", async () => {
  const operations = fakeOperations();
  const controller = new WorkspaceReplacementController(operations);
  controller.setText("next");
  const completion = controller.preview(
    { root: "/repo", generation: 3 },
    searchRequest(),
    String,
  );
  assert.equal(controller.state.dialog, "preview");
  assert.equal(controller.state.replacement.status, "previewing");

  operations.completePreview(preview(operations.previewId));
  assert.equal(await completion, true);
  assert.equal(controller.state.replacement.status, "ready");
  assert.deepEqual([...controller.state.replacement.selectedPaths], ["src/a.ts", "src/b.ts"]);

  controller.toggleFile("src/b.ts");
  assert.deepEqual([...controller.state.replacement.selectedPaths], ["src/a.ts"]);
  controller.selectAll(false);
  assert.equal(controller.state.replacement.selectedPaths.size, 0);
  controller.closeDialog();
  assert.equal(controller.state.dialog, null);
  assert.equal(controller.state.replacement.status, "idle");
});

test("an invalidated preview rejects its late completion", async () => {
  const operations = fakeOperations();
  const controller = new WorkspaceReplacementController(operations);
  const completion = controller.preview(
    { root: "/repo", generation: 3 },
    searchRequest(),
    String,
  );
  controller.invalidatePreview();
  assert.equal(operations.cancellations, 1);
  operations.completePreview(preview(operations.previewId));
  assert.equal(await completion, false);
  assert.equal(controller.state.replacement.preview, null);
});

test("edited replacement refreshes the reviewed plan and preserves explicit selection", async () => {
  const operations = fakeOperations();
  const controller = new WorkspaceReplacementController(operations);
  controller.setText("next");
  const initial = controller.preview({ root: "/repo", generation: 3 }, searchRequest(), String);
  operations.completePreview(preview(operations.previewId));
  await initial;
  controller.toggleFile("src/b.ts");
  controller.setText("newer");

  const refreshed = controller.refreshPreview({ root: "/repo", generation: 3 }, String);
  operations.completePreview(preview(operations.previewId));
  assert.equal(await refreshed, true);
  assert.equal(controller.state.replacement.request.replacement, "newer");
  assert.deepEqual([...controller.state.replacement.selectedPaths], ["src/a.ts"]);

  controller.hidePreview();
  assert.equal(controller.state.dialog, null);
  assert.equal(controller.state.replacement.status, "ready");
  controller.setText("bottom-window");
  const bottomRefresh = controller.refreshPreview({ root: "/repo", generation: 3 }, String);
  assert.equal(controller.state.dialog, null);
  operations.completePreview(preview(operations.previewId));
  assert.equal(await bottomRefresh, true);
  assert.equal(controller.state.dialog, null);
  controller.showPreview();
  assert.equal(controller.state.dialog, "preview");
});

test("apply and recovery operations retain one busy and recovery owner", async () => {
  const operations = fakeOperations();
  const controller = new WorkspaceReplacementController(operations);
  const previewCompletion = controller.preview(
    { root: "/repo", generation: 3 },
    searchRequest(),
    String,
  );
  operations.completePreview(preview(operations.previewId));
  await previewCompletion;

  const applyCompletion = controller.apply("/repo", String);
  assert.equal(controller.state.replacement.status, "applying");
  operations.completeApply(applyResult("recovery-1"));
  const applied = await applyCompletion;
  assert.equal(applied.status, "success");
  assert.equal(controller.state.dialog, "recovery");

  operations.recoveries = [recovery("recovery-1")];
  const loaded = await controller.loadRecoveries("/repo", () => true);
  assert.equal(loaded.status, "success");
  const resolving = controller.resolveRecovery("/repo", "recovery-1", "keep");
  assert.deepEqual(controller.state.recoveryBusy, { id: "recovery-1", action: "keep" });
  operations.completeFinalize();
  assert.equal((await resolving).status, "success");
  assert.equal(controller.state.recoveryBusy, null);

  operations.recoveries = [];
  await controller.loadRecoveries("/repo", () => true);
  assert.equal(controller.reconcileRecoveryDialog(), 0);
  assert.equal(controller.state.dialog, null);
});

test("interactive replacement files keep an optimistic editable session", async () => {
  const operations = fakeOperations();
  const controller = new WorkspaceReplacementController(operations);
  controller.setText("next");
  const prepared = controller.preview({ root: "/repo", generation: 3 }, searchRequest(), String);
  operations.completePreview(preview(operations.previewId));
  await prepared;

  const file = controller.state.replacement.preview.files[0];
  const firstLoad = controller.loadFileSession(file, String);
  const repeatedLoad = controller.loadFileSession(file, String);
  const [session, repeatedSession] = await Promise.all([firstLoad, repeatedLoad]);
  assert.equal(repeatedSession, session);
  assert.equal(operations.readDiffCalls, 1);
  assert.equal(operations.readFileCalls, 1);
  assert.equal(operations.lastDiffExpanded, false);
  assert.equal(session.originalContent, "before\n");
  assert.equal(session.proposedContent, "next\n");
  assert.equal(session.persistedContent, "before\n");

  controller.updateFileContent(file.workspacePath, "next\n");
  const saved = await controller.saveFileSession(file.workspacePath, String);
  assert.equal(saved.status, "saved");
  assert.equal(controller.fileSession(file.workspacePath).persistedContent, "next\n");
  assert.equal(controller.fileSession(file.workspacePath).revision, "revision-2");
  assert.equal(operations.saved.content, "next\n");
  assert.equal(operations.saved.expectedRevision, "revision-1");
});

function fakeOperations() {
  let previewResolve = null;
  let previewSequence = 0;
  let applyResolve = null;
  let finalizeResolve = null;
  return {
    previewId: "",
    cancellations: 0,
    recoveries: [],
    saved: null,
    readDiffCalls: 0,
    readFileCalls: 0,
    lastDiffExpanded: null,
    startReplacementPreview() {
      this.previewId = `preview-${++previewSequence}`;
      return {
        operationId: this.previewId,
        completion: new Promise((resolve) => { previewResolve = resolve; }),
      };
    },
    applyReplacement() {
      return new Promise((resolve) => { applyResolve = resolve; });
    },
    cancelReplacement() { this.cancellations += 1; },
    async listRecoveries() { return this.recoveries; },
    async rollback() { return applyResult("recovery-1"); },
    finalize() { return new Promise((resolve) => { finalizeResolve = resolve; }); },
    async readReplacementDiff(_root, _planId, workspacePath, expanded) {
      this.readDiffCalls += 1;
      this.lastDiffExpanded = expanded;
      return { workspacePath, patch: "", truncated: false, originalContent: "before\n", proposedContent: "next\n" };
    },
    async readReplacementFile(_root, _repositoryId, path) {
      this.readFileCalls += 1;
      return { workspacePath: path, content: "before\n", utf8Bom: false, revision: "revision-1", byteLength: 7 };
    },
    async saveReplacementFile(_root, _repositoryId, path, expectedRevision, content, utf8Bom, requestId) {
      this.saved = { path, expectedRevision, content, utf8Bom, requestId };
      return { workspacePath: path, revision: "revision-2", byteLength: content.length, requestId, alreadySaved: false };
    },
    completePreview(value) { previewResolve({ status: "success", value }); },
    completeApply(value) { applyResolve({ status: "success", value }); },
    completeFinalize() { finalizeResolve(); },
  };
}

function searchRequest() {
  return {
    generation: 1,
    repositoryGeneration: 3,
    repositoryRoot: "/repo",
    requestId: "search-1",
    query: "before",
    options: { mode: "literal", includeGlobs: [], excludeGlobs: [], contextLines: 0 },
  };
}

function preview(planId) {
  return {
    planId,
    files: [
      { repositoryId: ".", path: "src/a.ts", workspacePath: "src/a.ts", matchCount: 1, byteDelta: 0, occurrences: [] },
      { repositoryId: ".", path: "src/b.ts", workspacePath: "src/b.ts", matchCount: 2, byteDelta: 1, occurrences: [] },
    ],
  };
}

function applyResult(recoveryId) {
  return {
    recoveryId,
    status: "applied",
    files: [{ workspacePath: "src/a.ts", state: "replaced" }],
    message: null,
  };
}

function recovery(recoveryId) {
  return {
    recoveryId,
    status: "applied",
    files: [{ workspacePath: "src/a.ts", state: "replaced" }],
  };
}
