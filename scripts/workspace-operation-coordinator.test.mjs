import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceOperationCoordinator } from "../src/application/workspace-operation-coordinator.ts";

test("workspace operation coordinator cancels superseded searches and rejects late results", async () => {
  const first = deferred();
  const cancelled = [];
  let identity = { root: "/repo", generation: 1 };
  const coordinator = new WorkspaceOperationCoordinator({
    searchWorkspaceText(_root, id) {
      return id.endsWith("-1") ? first.promise : Promise.resolve(report(id));
    },
    async cancelWorkspaceTextSearch(root, id) { cancelled.push([root, id]); },
    ...replacementGateway(),
  }, () => identity);

  const stale = coordinator.startSearch(identity, "first", options());
  const current = coordinator.startSearch(identity, "second", options());
  first.resolve(report(stale.operationId));
  assert.equal((await stale.completion).status, "stale");
  assert.equal((await current.completion).status, "success");
  assert.deepEqual(cancelled, [["/repo", stale.operationId]]);

  const moved = coordinator.startSearch(identity, "third", options());
  identity = { root: "/other", generation: 2 };
  assert.equal((await moved.completion).status, "stale");
});

test("replacement apply is bound to its reviewed plan and window generation", async () => {
  const applied = [];
  const identity = { root: "/repo", generation: 4 };
  const coordinator = new WorkspaceOperationCoordinator({
    async searchWorkspaceText() { throw new Error("unused"); },
    async cancelWorkspaceTextSearch() {},
    ...replacementGateway(applied),
  }, () => identity);
  const preview = coordinator.startReplacementPreview(identity, "old", "new", options());
  assert.equal((await preview.completion).status, "success");
  assert.equal(
    (await coordinator.applyReplacement(identity, "another-plan", ["src/app.ts"])).status,
    "stale",
  );
  const result = await coordinator.applyReplacement(identity, preview.operationId, ["src/app.ts"]);
  assert.equal(result.status, "success");
  assert.deepEqual(applied, [["/repo", preview.operationId, ["src/app.ts"]]]);
});

function replacementGateway(applied = []) {
  return {
    async previewWorkspaceReplacement(_root, planId) {
      return { planId, files: [], totalMatches: 0, skippedCount: 0, coverageReasons: [] };
    },
    async applyWorkspaceReplacement(root, planId, paths) {
      applied.push([root, planId, paths]);
      return { recoveryId: "recovery", status: "applied", files: [], message: "done" };
    },
    async cancelWorkspaceReplacement() {},
    async listWorkspaceReplacementRecoveries() { return []; },
    async rollbackWorkspaceReplacement() {
      return { recoveryId: "recovery", status: "rolledBack", files: [], message: "done" };
    },
    async finalizeWorkspaceReplacement() {},
  };
}

function report(requestId) {
  return {
    requestId,
    matches: [],
    catalogCandidates: 0,
    eligibleCandidates: 0,
    filesSearched: 0,
    bytesRead: 0,
    skippedCount: 0,
    skippedFiles: [],
    coverageReasons: [],
  };
}

function options() {
  return {
    mode: "literal",
    caseSensitive: false,
    includeGlobs: [],
    excludeGlobs: [],
    contextLines: 0,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
