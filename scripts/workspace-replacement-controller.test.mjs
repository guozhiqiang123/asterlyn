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

function fakeOperations() {
  let previewResolve = null;
  let applyResolve = null;
  let finalizeResolve = null;
  return {
    previewId: "",
    cancellations: 0,
    recoveries: [],
    startReplacementPreview() {
      this.previewId = "preview-1";
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
      { workspacePath: "src/a.ts", matchCount: 1, byteDelta: 0 },
      { workspacePath: "src/b.ts", matchCount: 2, byteDelta: 1 },
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
