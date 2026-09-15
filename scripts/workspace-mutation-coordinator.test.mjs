import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceMutationCoordinator } from "../src/application/workspace-mutation-coordinator.ts";

const identity = { root: "/repo", generation: 1 };
const move = { kind: "move", source: "a.ts", destination: "b.ts" };
const editorRequest = {
  kind: "move",
  mapping: {
    sourceWorkspacePath: "a.ts",
    destinationWorkspacePath: "b.ts",
    sourceRepositoryId: ".",
    destinationRepositoryId: ".",
    sourcePath: "a.ts",
    destinationPath: "b.ts",
  },
};

test("a newer workspace plan makes an older completion stale", async () => {
  const first = deferred();
  const second = deferred();
  const gateway = fakeGateway({ plans: [first.promise, second.promise] });
  const coordinator = new WorkspaceMutationCoordinator(
    gateway,
    fakeEditor(),
    () => true,
    fakeReconciliation(),
  );
  const old = coordinator.plan(identity, { kind: "createFile", destination: "old" }, "cancel");
  const current = coordinator.plan(identity, { kind: "createFile", destination: "new" }, "cancel");
  first.resolve(preview(old.planId, { kind: "createFile", destination: "old" }));
  second.resolve(preview(current.planId, { kind: "createFile", destination: "new" }));

  assert.deepEqual(await old.completion, { status: "stale" });
  assert.equal((await current.completion).status, "ready");
  assert.equal((await coordinator.execute(identity, old.planId)).status, "stale");
});

test("workspace and editor blockers never reach execution", async () => {
  const blocked = preview("ignored", move);
  blocked.blockers = [{ kind: "destinationExists", path: "b.ts" }];
  const gateway = fakeGateway({ plans: [Promise.resolve(blocked)] });
  const coordinator = new WorkspaceMutationCoordinator(
    gateway,
    fakeEditor(),
    () => true,
    fakeReconciliation(),
  );
  const planned = coordinator.plan(identity, move, "cancel", editorRequest);
  assert.equal((await planned.completion).status, "blocked");
  assert.equal(gateway.executions.length, 0);

  const editor = fakeEditor({ preparation: { status: "blocked", reason: "dirtyDelete" } });
  const secondGateway = fakeGateway();
  const second = new WorkspaceMutationCoordinator(
    secondGateway,
    editor,
    () => true,
    fakeReconciliation(),
  );
  const request = second.plan(identity, move, "cancel", editorRequest);
  const result = await request.completion;
  assert.equal(result.status, "blocked");
  assert.equal(result.source, "editor");
  assert.equal(secondGateway.cancellations.length, 1);
});

test("completed move applies its editor lease and failures release it", async () => {
  const editor = fakeEditor();
  const runtimeChanges = [];
  const gateway = fakeGateway({ outcomes: [Promise.resolve(outcome("completed"))] });
  const coordinator = new WorkspaceMutationCoordinator(
    gateway,
    editor,
    (change) => { runtimeChanges.push(change); return true; },
    fakeReconciliation(),
  );
  const planned = coordinator.plan(identity, move, "cancel", editorRequest);
  assert.equal((await planned.completion).status, "ready");
  assert.equal((await coordinator.execute(identity, planned.planId)).status, "completed");
  assert.equal(editor.applied.length, 1);
  assert.equal(editor.released.length, 0);
  assert.equal(runtimeChanges.length, 1);

  const failedEditor = fakeEditor();
  const failedGateway = fakeGateway({ outcomes: [Promise.reject(new Error("failed"))] });
  const failed = new WorkspaceMutationCoordinator(
    failedGateway,
    failedEditor,
    () => true,
    fakeReconciliation(),
  );
  const failedPlan = failed.plan(identity, move, "cancel", editorRequest);
  await failedPlan.completion;
  assert.equal((await failed.execute(identity, failedPlan.planId)).status, "failure");
  assert.equal(failedEditor.released.length, 1);
});

test("cancelling an executing mutation holds the editor lease until completion", async () => {
  const pending = deferred();
  const editor = fakeEditor();
  const gateway = fakeGateway({ outcomes: [pending.promise] });
  const reconciliation = fakeReconciliation();
  const coordinator = new WorkspaceMutationCoordinator(
    gateway,
    editor,
    () => true,
    reconciliation,
  );
  const planned = coordinator.plan(identity, move, "cancel", editorRequest);
  await planned.completion;
  const executing = coordinator.execute(identity, planned.planId);
  coordinator.cancel();
  assert.equal(editor.released.length, 0);
  pending.resolve(outcome("cancelledBeforeWrite"));
  assert.equal((await executing).status, "completed");
  assert.equal(editor.released.length, 1);
  assert.equal(reconciliation.settled.length, 1);
});

test("execution waits for versioned reconciliation before reporting completion", async () => {
  const pending = deferred();
  const reconciliation = fakeReconciliation({ results: [pending.promise] });
  const coordinator = new WorkspaceMutationCoordinator(
    fakeGateway(),
    fakeEditor(),
    () => true,
    reconciliation,
  );
  const planned = coordinator.plan(identity, move, "cancel", editorRequest);
  await planned.completion;
  const executing = coordinator.execute(identity, planned.planId);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(reconciliation.accepted.length, 1);
  assert.equal(reconciliation.settled.length, 0);
  pending.resolve({ status: "accepted" });
  assert.equal((await executing).status, "completed");
  assert.equal(reconciliation.settled.length, 1);
});

test("stale and failed reconciliation cannot be reported as successful", async () => {
  const staleReconciliation = fakeReconciliation({
    results: [Promise.resolve({ status: "stale" })],
  });
  const stale = new WorkspaceMutationCoordinator(
    fakeGateway(),
    fakeEditor(),
    () => true,
    staleReconciliation,
  );
  const stalePlan = stale.plan(identity, move, "cancel", editorRequest);
  await stalePlan.completion;
  assert.equal((await stale.execute(identity, stalePlan.planId)).status, "stale");

  const failedReconciliation = fakeReconciliation({
    results: [Promise.resolve({ status: "failure", error: new Error("refresh failed") })],
  });
  const failed = new WorkspaceMutationCoordinator(
    fakeGateway(),
    fakeEditor(),
    () => true,
    failedReconciliation,
  );
  const failedPlan = failed.plan(identity, move, "cancel", editorRequest);
  await failedPlan.completion;
  const result = await failed.execute(identity, failedPlan.planId);
  assert.equal(result.status, "reconciliation-required");
  assert.match(result.error.message, /refresh failed/);
});

test("a stale session cannot begin workspace mutation execution", async () => {
  const editor = fakeEditor();
  const reconciliation = fakeReconciliation({ begin: null });
  const gateway = fakeGateway();
  const coordinator = new WorkspaceMutationCoordinator(
    gateway,
    editor,
    () => true,
    reconciliation,
  );
  const planned = coordinator.plan(identity, move, "cancel", editorRequest);
  await planned.completion;

  assert.equal((await coordinator.execute(identity, planned.planId)).status, "stale");
  assert.equal(gateway.executions.length, 0);
  assert.equal(editor.released.length, 1);
});

function preview(planId, operation) {
  return {
    planId,
    operation,
    collisionPolicy: "cancel",
    source: null,
    entryCount: 0,
    totalBytes: 0,
    fingerprint: null,
    blockers: [],
  };
}

function outcome(status) {
  return {
    planId: "plan",
    status,
    affectedPaths: [],
    pathRemaps: status === "completed" ? [{ source: "a.ts", destination: "b.ts" }] : [],
    invalidatedSlices: ["workspaceCatalog", "openDocuments", "workingTree"],
    recoveryId: null,
    error: null,
  };
}

function fakeGateway(options = {}) {
  const plans = [...(options.plans ?? [])];
  const outcomes = [...(options.outcomes ?? [])];
  return {
    executions: [],
    cancellations: [],
    planWorkspaceMutation(_root, planId, operation) {
      return (plans.shift() ?? Promise.resolve(preview(planId, operation)))
        .then((result) => ({ ...result, planId }));
    },
    executeWorkspaceMutation(root, planId) {
      this.executions.push([root, planId]);
      return (outcomes.shift() ?? Promise.resolve(outcome("completed")))
        .then((result) => ({ ...result, planId }));
    },
    async cancelWorkspaceMutation(root, planId) {
      this.cancellations.push([root, planId]);
    },
    async listWorkspaceMutationRecoveries() { return []; },
  };
}

function fakeEditor(options = {}) {
  const lease = { id: 1, workspaceRoot: "/repo", workspaceGeneration: 1, editor: { tabs: [] } };
  return {
    applied: [],
    released: [],
    preparePathMigration() { return options.preparation ?? { status: "ready", lease }; },
    applyPathMigration(current, runtime) {
      this.applied.push(current);
      runtime({ remaps: [], disposedTabIds: [] });
      return "applied";
    },
    releasePathMigration(current) { this.released.push(current); },
  };
}

function fakeReconciliation(options = {}) {
  const results = [...(options.results ?? [])];
  const lease = options.begin === undefined
    ? { root: "/repo", generation: 2 }
    : options.begin;
  return {
    begun: [],
    accepted: [],
    settled: [],
    begin(current) {
      this.begun.push(current);
      return lease;
    },
    accept(current, currentOutcome) {
      this.accepted.push([current, currentOutcome]);
      return results.shift() ?? Promise.resolve({ status: "accepted" });
    },
    settle(current) { this.settled.push(current); },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
