import assert from "node:assert/strict";
import test from "node:test";

import { repositoryReconciliationPlan } from "../src/application/repository-mutation.ts";

function outcome(invalidatedSlices) {
  return { snapshot: {}, invalidatedSlices };
}

test("working-tree mutations do not request history or ref reconciliation", () => {
  const plan = repositoryReconciliationPlan(outcome(["workingTree"]));
  assert.equal(plan.updateWorkingTree, true);
  assert.equal(plan.reconcileOpenDocuments, true);
  assert.equal(plan.updateHistory, false);
  assert.equal(plan.updateRemote, false);
  assert.equal(plan.reloadWorkspaceCatalog, false);
});

test("fetch reconciles refs and history without replacing files or open documents", () => {
  const plan = repositoryReconciliationPlan(outcome(["head", "refs", "history"]));
  assert.equal(plan.updateRemote, true);
  assert.equal(plan.updateHistory, true);
  assert.equal(plan.updateWorkingTree, false);
  assert.equal(plan.reconcileOpenDocuments, false);
  assert.equal(plan.reloadWorkspaceCatalog, false);
});

test("branch-changing operations explicitly request every session slice", () => {
  const plan = repositoryReconciliationPlan(outcome([
    "workspaceCatalog",
    "openDocuments",
    "workingTree",
    "head",
    "refs",
    "history",
    "operation",
  ]));
  assert.equal(plan.slices.size, 7);
  assert.equal(plan.reloadWorkspaceCatalog, true);
  assert.equal(plan.reconcileOpenDocuments, true);
  assert.equal(plan.reconcileOperation, true);
});
