import assert from "node:assert/strict";
import test from "node:test";

import { CommitFileRestoreController } from "../src/features/git-history/commit-file-restore-controller.ts";

const target = {
  workspaceRoot: "/repo",
  workspaceGeneration: 1,
  repositoryRevision: 2,
  workspacePath: "src/app.ts",
  repositoryId: ".",
  oid: "a".repeat(40),
  parentOid: "b".repeat(40),
  path: "src/app.ts",
  kind: "file",
  file: { path: "src/app.ts", originalPath: null, status: "modified" },
  descendants: [],
  historyGeneration: 3,
};

function preview(planId) {
  return {
    planId, workspacePath: "src/app.ts", action: "overwrite", expectedRevision: "current",
    currentMode: 0o644, restoredMode: 0o644, currentByteLength: 10,
    restoredByteLength: 12, repositoryId: ".", commitOid: target.oid,
    revisionOid: target.oid, sourcePath: "src/app.ts", blobOid: "c".repeat(40), fileMode: "100644",
  };
}

function fixture() {
  const calls = [];
  let recovery = null;
  const controller = new CommitFileRestoreController({
    async prepare(root, planId, repositoryId, oid, selected) {
      calls.push(["prepare", root, repositoryId, oid, selected.path]);
      return preview(planId);
    },
    async execute(root, planId) {
      calls.push(["execute", root, planId]);
      recovery = { recoveryId: planId, workspacePath: "src/app.ts", status: "applied", fileState: "restored" };
      return recovery;
    },
    async listRecoveries() { return recovery ? [recovery] : []; },
    async rollback(root, id) {
      calls.push(["rollback", root, id]);
      recovery = null;
      return { recoveryId: null, workspacePath: "src/app.ts", status: "rolledBack", fileState: "original" };
    },
    async finalize(root, id) { calls.push(["finalize", root, id]); recovery = null; },
    async refresh(root, path) { calls.push(["refresh", root, path]); },
    lease: () => ({ current: () => true }),
    errorMessage: String,
  });
  return { controller, calls };
}

test("restore review binds exact history identity and retains durable undo", async () => {
  const { controller, calls } = fixture();
  const lease = { current: () => true };
  await controller.open(target, lease);
  assert.equal(controller.state.dialog.phase, "review");
  assert.equal(controller.state.dialog.preview.blobOid, "c".repeat(40));
  await controller.execute();
  assert.equal(controller.state.dialog.phase, "applied");
  assert.equal(controller.state.dialog.recoveries.length, 1);
  const recoveryId = controller.state.dialog.outcome.recoveryId;
  await controller.resolveRecovery(recoveryId, "rollback");
  assert.equal(controller.state.dialog, null);
  assert.deepEqual(calls.map((call) => call[0]), ["prepare", "execute", "refresh", "rollback", "refresh"]);
});

test("an editor lease changed after review blocks native execution", async () => {
  const { controller, calls } = fixture();
  let current = true;
  await controller.open(target, { current: () => current });
  current = false;
  await controller.execute();
  assert.equal(controller.state.dialog.phase, "review");
  assert.equal(controller.state.dialog.error, "editor-changed");
  assert.deepEqual(calls.map((call) => call[0]), ["prepare"]);
});

test("restart recovery discovery opens a bounded recovery review", async () => {
  const { controller } = fixture();
  // Establish one durable record through the public flow, then simulate a new controller.
  await controller.open(target, { current: () => true });
  await controller.execute();
  controller.reset();
  await controller.loadRecoveries("/repo", true);
  assert.equal(controller.state.dialog.phase, "recovery");
  assert.equal(controller.state.dialog.recoveries[0].workspacePath, "src/app.ts");
});
