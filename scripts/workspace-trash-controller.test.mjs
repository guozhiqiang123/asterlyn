import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceTrashController } from "../src/application/workspace-trash-controller.ts";

const messages = { targetChanged: "changed", blocked: "blocked", operationFailed: "failed", trashed: "trashed" };
const target = {
  workspaceRoot: "/workspace", workspaceGeneration: 4, workspacePath: "src/app.ts", kind: "file",
};

function preview(planId = "plan-1") {
  return {
    planId, operation: { kind: "trash", source: "src/app.ts" }, collisionPolicy: "cancel",
    source: null, entryCount: 1, totalBytes: 4, hiddenEntryCount: 0,
    fingerprint: "fingerprint", blockers: [],
  };
}

function fixture() {
  const records = { plans: [], executions: [], cancels: 0, completed: [], status: [], errors: [] };
  let current = { root: "/workspace", generation: 4 };
  let targetCurrent = true;
  let nextPlan = { status: "ready", preview: preview() };
  const controller = new WorkspaceTrashController(
    {
      plan(identity, operation, collisionPolicy, editorRequest) {
        records.plans.push({ identity, operation, collisionPolicy, editorRequest });
        return { planId: "plan-1", completion: Promise.resolve(nextPlan) };
      },
      async execute(identity, planId) {
        records.executions.push({ identity, planId });
        return {
          status: "completed",
          outcome: {
            planId, status: "completed", affectedPaths: ["src/app.ts"], pathRemaps: [],
            invalidatedSlices: ["workspaceCatalog", "openDocuments", "workingTree"],
            recoveryId: null, error: null,
          },
        };
      },
      cancel() { records.cancels += 1; },
    },
    {
      currentIdentity: () => current,
      isTargetCurrent: () => targetCurrent,
      completed: (...args) => records.completed.push(args),
      status: (message) => records.status.push(message),
      error: (error) => records.errors.push(error instanceof Error ? error.message : String(error)),
    },
    () => messages,
  );
  return {
    controller, records,
    setCurrent(value) { current = value; },
    setTargetCurrent(value) { targetCurrent = value; },
    setNextPlan(value) { nextPlan = value; },
  };
}

test("Trash plans exact paths and executes only after explicit confirmation", async () => {
  const { controller, records } = fixture();
  await controller.request(target);
  assert.deepEqual(records.plans[0].operation, { kind: "trash", source: "src/app.ts" });
  assert.deepEqual(records.plans[0].editorRequest, {
    kind: "trash", sourceWorkspacePath: "src/app.ts",
  });
  assert.equal(controller.state.dialog.preview.entryCount, 1);
  assert.deepEqual(records.executions, []);

  await controller.confirm();

  assert.equal(records.executions[0].planId, "plan-1");
  assert.equal(records.completed[0][0], target);
  assert.deepEqual(records.status, ["trashed"]);
});

test("closing a review cancels its plan and a stale target cannot execute", async () => {
  const closed = fixture();
  await closed.controller.request(target);
  closed.controller.close();
  assert.equal(closed.records.cancels, 1);
  assert.equal(closed.controller.state.dialog, null);

  const stale = fixture();
  await stale.controller.request(target);
  stale.setTargetCurrent(false);
  await stale.controller.confirm();
  assert.equal(stale.records.cancels, 1);
  assert.deepEqual(stale.records.executions, []);
  assert.deepEqual(stale.records.errors, ["changed"]);
});

test("blocked and replaced workspaces clear planning state without opening a review", async () => {
  const blocked = fixture();
  blocked.setNextPlan({ status: "blocked", source: "workspace", preview: preview(), reason: "link" });
  await blocked.controller.request(target);
  assert.equal(blocked.controller.busy, false);
  assert.deepEqual(blocked.records.errors, ["blocked"]);

  const replaced = fixture();
  let resolvePlan;
  replaced.controller.dispose();
  const records = { cancels: 0 };
  let current = { root: "/workspace", generation: 4 };
  const controller = new WorkspaceTrashController(
    {
      plan() {
        return { planId: "late", completion: new Promise((resolve) => { resolvePlan = resolve; }) };
      },
      async execute() { throw new Error("must not execute"); },
      cancel() { records.cancels += 1; },
    },
    {
      currentIdentity: () => current,
      isTargetCurrent: (candidate) => candidate.workspaceGeneration === current.generation,
      completed() {}, status() {}, error() {},
    },
    () => messages,
  );
  const pending = controller.request(target);
  current = { root: "/other", generation: 5 };
  resolvePlan({ status: "ready", preview: preview("late") });
  await pending;
  assert.equal(records.cancels, 1);
  assert.equal(controller.busy, false);
});
