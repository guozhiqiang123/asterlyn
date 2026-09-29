import assert from "node:assert/strict";
import test from "node:test";

import { ProjectFilesOperationController } from "../src/features/files-editor/project-files-operation-controller.ts";
import { projectFilesOperationMessages } from "../src/features/files-editor/project-files-operation-runtime.ts";
import { EN_US } from "../src/localization/en-US.ts";

const identity = { root: "/repo", generation: 7 };
const recovery = {
  recoveryId: "move-1",
  workspaceRoot: "/repo",
  operation: { kind: "move", source: "old.txt", destination: "new.txt" },
  phase: "source-held",
  sourceStates: [{ path: "old.txt", state: "missing" }],
  destination: "new.txt",
  destinationState: "matchesReviewed",
  heldSourceState: "matchesReviewed",
  supportedActions: ["rollback", "finalize"],
};

function setup({ blocked = false } = {}) {
  let recoveries = [structuredClone(recovery)];
  const calls = [];
  const mutations = {
    plan: () => { throw new Error("not used"); },
    execute: () => { throw new Error("not used"); },
    cancel() {},
    async listRecoveries() { return structuredClone(recoveries); },
    async rollbackRecovery(root, id) { calls.push(["rollback", root, id]); recoveries = []; },
    async finalizeRecovery(root, id) { calls.push(["finalize", root, id]); recoveries = []; },
    async acknowledgeRecovery(root, id) { calls.push(["acknowledge", root, id]); recoveries = []; },
  };
  const reconciled = [];
  const controller = new ProjectFilesOperationController(
    { inspectWorkspaceEntry: () => { throw new Error("not used"); } },
    mutations,
    {
      currentIdentity: () => identity,
      isTargetCurrent: () => true,
      repositoryLocation: () => null,
      canStageCreatedFile: () => false,
      newFileStageBehavior: () => "leaveUntracked",
      rememberNewFileStageBehavior() {},
      async stageCreatedFile() {},
      completed() {},
      recoveryBlocked: () => blocked,
      async reconcileRecovery(_identity, value, action) { reconciled.push([value.recoveryId, action]); },
      status() {},
      error(error) { throw error; },
    },
    () => projectFilesOperationMessages(EN_US.projectFiles.contextMenu),
    { busy: () => false, async request() {} },
  );
  return { controller, calls, reconciled };
}

test("restart discovery opens reviewed mutation recovery and rollback reconciles before closing", async () => {
  const { controller, calls, reconciled } = setup();
  await controller.loadRecoveries(identity, true);
  assert.equal(controller.state.dialog?.kind, "recovery");
  assert.equal(controller.state.recoveries.length, 1);
  assert.equal("sourceHold" in controller.state.recoveries[0], false);

  await controller.resolveRecovery("move-1", "rollback");
  assert.deepEqual(calls, [["rollback", "/repo", "move-1"]]);
  assert.deepEqual(reconciled, [["move-1", "rollback"]]);
  assert.equal(controller.state.dialog, null);
  assert.deepEqual(controller.state.recoveries, []);
});

test("dirty editor protection and backend-supported actions fail closed", async () => {
  const blocked = setup({ blocked: true });
  await blocked.controller.loadRecoveries(identity, true);
  await blocked.controller.resolveRecovery("move-1", "rollback");
  assert.deepEqual(blocked.calls, []);
  assert.equal(blocked.controller.state.recoveryError, EN_US.projectFiles.contextMenu.recoveryDirty);

  const unsupported = setup();
  await unsupported.controller.loadRecoveries(identity, true);
  await unsupported.controller.resolveRecovery("move-1", "acknowledge");
  assert.deepEqual(unsupported.calls, []);
  assert.equal(unsupported.controller.state.recoveries.length, 1);
});
