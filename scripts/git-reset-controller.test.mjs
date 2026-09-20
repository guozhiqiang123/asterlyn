import assert from "node:assert/strict";
import test from "node:test";

import { GitResetController } from "../src/features/git-history/git-reset-controller.ts";

const target = { repositoryRoot: "/repo", oid: "a".repeat(40), shortOid: "aaaaaaaa", subject: "older" };
const plan = { repositoryRoot: "/repo", startHeadRef: "refs/heads/main", startHeadOid: "b".repeat(40), targetOid: target.oid, previewToken: "lease" };

test("reset review defaults to Mixed and executes the exact prepared plan", async () => {
  const calls = [];
  const controller = new GitResetController({
    async prepare(root, oid) { calls.push(["prepare", root, oid]); return plan; },
    async execute(value, mode) { calls.push(["execute", value, mode]); return true; },
    errorMessage(error) { return String(error); },
  });
  controller.open(target);
  await Promise.resolve();
  assert.equal(controller.state.dialog.mode, "mixed");
  controller.selectMode("hard");
  await controller.execute();
  assert.equal(controller.state.dialog, null);
  assert.deepEqual(calls, [["prepare", "/repo", target.oid], ["execute", plan, "hard"]]);
});

test("a later reset target rejects an obsolete prepare completion", async () => {
  const completions = [];
  const controller = new GitResetController({
    prepare() { return new Promise((resolve) => completions.push(resolve)); },
    async execute() { return true; }, errorMessage: String,
  });
  controller.open(target);
  controller.open({ ...target, oid: "c".repeat(40) });
  completions[0](plan);
  await Promise.resolve();
  assert.equal(controller.state.dialog.plan, null);
  completions[1]({ ...plan, targetOid: "c".repeat(40) });
  await Promise.resolve();
  assert.equal(controller.state.dialog.plan.targetOid, "c".repeat(40));
});
