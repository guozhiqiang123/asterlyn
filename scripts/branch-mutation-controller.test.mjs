import assert from "node:assert/strict";
import test from "node:test";

import { BranchMutationController } from "../src/features/git-history/branch-mutation-controller.ts";

const branch = {
  repositoryId: ".", kind: "local", fullName: "refs/heads/topic", name: "topic",
  current: false, upstream: null, tracking: null, oid: "b".repeat(40), subject: "topic", committedAt: 1,
};

function plan(request) {
  return {
    repositoryRoot: "/repo", kind: request.kind, sourceFullName: request.sourceFullName,
    sourceOid: request.sourceOid, sourceKind: "local", sourceName: "topic",
    targetFullName: request.newName ? `refs/heads/${request.newName}` : null,
    newName: request.newName, startHeadRef: "refs/heads/main", startHeadOid: "a".repeat(40),
    upstream: null, mergedIntoCurrent: request.kind === "delete" ? true : null, previewToken: "token",
  };
}

test("named non-destructive mutations prepare and execute in one submission", async () => {
  const calls = [];
  const controller = new BranchMutationController({
    async prepare(root, request) { calls.push(["prepare", root, { ...request }]); return plan(request); },
    async execute(value) { calls.push(["execute", value.previewToken]); return true; },
    errorMessage: String,
  });
  let renders = 0;
  controller.subscribe(() => renders += 1);
  controller.open("/repo", "create", branch);
  const rendersAfterOpen = renders;
  controller.updateValue("feature/menu");
  assert.equal(renders, rendersAfterOpen, "typing must not replace the focused input");
  await controller.submit();
  assert.equal(controller.state.dialog, null);
  assert.deepEqual(calls[0], ["prepare", "/repo", {
    kind: "create", sourceFullName: branch.fullName, sourceOid: branch.oid, newName: "feature/menu",
  }]);
  assert.deepEqual(calls[1], ["execute", "token"]);
});

test("delete begins review immediately and a failed execution keeps the reviewed plan", async () => {
  let prepared = false;
  const controller = new BranchMutationController({
    async prepare(_root, request) { prepared = true; return plan(request); },
    async execute() { return false; },
    errorMessage: String,
  });
  controller.open("/repo", "delete", branch);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(prepared, true);
  assert.equal(controller.state.dialog.plan.mergedIntoCurrent, true);
  await controller.execute();
  assert.equal(controller.state.dialog.error, "branch-mutation-failed");
  assert.equal(controller.state.dialog.plan.previewToken, "token");
});

test("switch prepares and executes directly without a confirmation state", async () => {
  const calls = [];
  const controller = new BranchMutationController({
    async prepare(_root, request) { calls.push("prepare"); return plan(request); },
    async execute() { calls.push("execute"); return true; },
    errorMessage: String,
  });
  controller.open("/repo", "switch", branch);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ["prepare", "execute"]);
  assert.equal(controller.state.dialog, null);
});
