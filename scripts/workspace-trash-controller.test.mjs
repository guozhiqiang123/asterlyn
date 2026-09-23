import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeTrashTargets,
  WorkspaceTrashController,
} from "../src/application/workspace-trash-controller.ts";

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

function fixture({ reconcile } = {}) {
  const records = {
    plans: [], executions: [], reconciliations: [], cancels: 0, completed: [],
    status: [], errors: [], reconciliationErrors: [], sequence: [],
  };
  let current = { root: "/workspace", generation: 4 };
  let targetCurrent = true;
  let nextPlan = { status: "ready", preview: preview() };
  let nextExecution = null;
  const mutations = {
    plan(identity, operation, collisionPolicy, editorRequest) {
      records.plans.push({ identity, operation, collisionPolicy, editorRequest });
      return { planId: "plan-1", completion: Promise.resolve(nextPlan) };
    },
    async execute(identity, planId, options) {
      records.executions.push({ identity, planId, options });
      return nextExecution ?? {
        status: "completed",
        outcome: {
          planId, status: "completed", affectedPaths: ["src/app.ts"], pathRemaps: [],
          invalidatedSlices: ["workspaceCatalog", "openDocuments", "workingTree"],
          recoveryId: null, error: null,
        },
      };
    },
    cancel() { records.cancels += 1; },
  };
  if (reconcile) {
    mutations.reconcile = (identity, outcome) => {
      records.sequence.push("reconcile");
      records.reconciliations.push({ identity, outcome });
      return reconcile(identity, outcome);
    };
  }
  const controller = new WorkspaceTrashController(
    mutations,
    {
      currentIdentity: () => current,
      isTargetCurrent: () => targetCurrent,
      completed: (...args) => {
        records.sequence.push("completed");
        records.completed.push(args);
      },
      reconciliationFailed: (error) => records.reconciliationErrors.push(
        error instanceof Error ? error.message : String(error),
      ),
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
    setNextExecution(value) { nextExecution = value; },
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
  assert.equal(records.executions[0].options, undefined);
  assert.deepEqual(records.completed[0][0], [target]);
  assert.deepEqual(records.status, ["trashed"]);
});

test("Trash reports visible completion before background reconciliation settles", async () => {
  const reconciliation = deferred();
  const { controller, records } = fixture({ reconcile: () => reconciliation.promise });
  await controller.request(target);

  let confirmationResolved = false;
  const confirmation = controller.confirm().then(() => { confirmationResolved = true; });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(confirmationResolved, true);
  assert.equal(controller.state.dialog, null);
  assert.deepEqual(records.executions[0].options, { reconcile: false });
  assert.deepEqual(records.completed[0][0], [target]);
  assert.deepEqual(records.status, ["trashed"]);
  assert.equal(records.reconciliations.length, 1);
  assert.deepEqual(records.sequence, ["reconcile", "completed"]);

  reconciliation.resolve({ status: "failure", error: new Error("refresh failed") });
  await confirmation;
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(records.reconciliationErrors, ["refresh failed"]);
});

test("a completed native Trash still reconciles after an editor migration conflict", async () => {
  const outcome = {
    planId: "plan-1", status: "completed", affectedPaths: ["src/app.ts"], pathRemaps: [],
    invalidatedSlices: ["workspaceCatalog", "openDocuments", "workingTree"],
    recoveryId: null, error: null,
  };
  const fixtureState = fixture({ reconcile: async () => ({ status: "accepted" }) });
  fixtureState.setNextExecution({ status: "editor-conflict", outcome, reason: "runtime-conflict" });
  await fixtureState.controller.request(target);

  await fixtureState.controller.confirm();
  await Promise.resolve();

  assert.deepEqual(fixtureState.records.completed[0][0], [target]);
  assert.equal(fixtureState.records.reconciliations.length, 1);
  assert.deepEqual(fixtureState.records.errors, ["failed"]);
  assert.equal(fixtureState.controller.state.dialog, null);
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

test("normalizeTrashTargets prunes duplicates and descendants", () => {
  const t = (path) => ({ ...target, workspacePath: path });
  const input = [
    t("src/feature"),
    t("src/feature/sub/file.ts"),
    t("src/app.ts"),
    t("src/feature/file.ts"),
    t("src/app.ts"),
  ];
  const normalized = normalizeTrashTargets(input);
  assert.deepEqual(
    normalized.map((x) => x.workspacePath),
    ["src/app.ts", "src/feature"],
  );
});

test("multi-selection Trash plans all targets upfront and executes on confirmation", async () => {
  const { controller, records } = fixture();
  const multiTarget = {
    ...target,
    workspacePath: "src/a.ts",
    selectedTargets: [
      { ...target, workspacePath: "src/a.ts" },
      { ...target, workspacePath: "src/b.ts" },
    ],
  };
  await controller.request(multiTarget);
  assert.equal(controller.state.dialog.targets.length, 2);
  assert.equal(records.plans.length, 1);
  assert.deepEqual(records.plans[0].operation, { kind: "trash", sources: ["src/a.ts", "src/b.ts"] });

  await controller.confirm();

  assert.equal(records.executions.length, 1);
  assert.equal(records.completed.length, 1);
  assert.deepEqual(records.completed[0][0], multiTarget.selectedTargets);
});

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
