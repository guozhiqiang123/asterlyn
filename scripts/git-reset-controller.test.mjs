import assert from "node:assert/strict";
import test from "node:test";

import { GitResetController } from "../src/features/git-history/git-reset-controller.ts";
import { renderGitResetDialog } from "../src/features/git-history/git-reset-view.ts";
import { EN_GIT_RESET_COPY } from "../src/localization/git-reviewed-copy.ts";

const target = { repositoryRoot: "/repo", repositoryId: "modules/library", oid: "a".repeat(40), shortOid: "aaaaaaaa", subject: "older" };
const plan = { repositoryRoot: "/repo", startHeadRef: "refs/heads/main", startHeadOid: "b".repeat(40), targetOid: target.oid, previewToken: "lease" };

test("reset review defaults to Mixed and executes the exact prepared plan", async () => {
  const calls = [];
  const controller = new GitResetController({
    async prepare(root, repositoryId, oid, intent) { calls.push(["prepare", root, repositoryId, oid, intent]); return plan; },
    async execute(repositoryId, value, mode, intent) { calls.push(["execute", repositoryId, value, mode, intent]); return true; },
    errorMessage(error) { return String(error); },
  });
  controller.open(target);
  await Promise.resolve();
  assert.equal(controller.state.dialog.mode, "mixed");
  controller.selectMode("hard");
  await controller.execute();
  assert.equal(controller.state.dialog, null);
  assert.deepEqual(calls, [["prepare", "/repo", "modules/library", target.oid, "reset"], ["execute", "modules/library", plan, "hard", "reset"]]);
});

test("latest commit actions lock their reset semantics and route the reviewed intent", async () => {
  const calls = [];
  const controller = new GitResetController({
    async prepare(root, repositoryId, oid, intent) { calls.push(["prepare", root, repositoryId, oid, intent]); return plan; },
    async execute(repositoryId, value, mode, intent) { calls.push(["execute", repositoryId, value, mode, intent]); return true; },
    errorMessage: String,
  });
  controller.open(target, "undoCommit");
  await Promise.resolve();
  controller.selectMode("hard");
  assert.equal(controller.state.dialog.mode, "mixed");
  await controller.execute();
  assert.deepEqual(calls, [
    ["prepare", "/repo", "modules/library", target.oid, "undoCommit"],
    ["execute", "modules/library", plan, "mixed", "undoCommit"],
  ]);

  controller.open(target, "dropCommit");
  await Promise.resolve();
  assert.equal(controller.state.dialog.mode, "hard");
  const dropReview = renderGitResetDialog(controller.state, EN_GIT_RESET_COPY);
  assert.match(dropReview, /Drop Commit/);
  assert.match(dropReview, /danger-button/);
  assert.doesNotMatch(dropReview, /name="git-reset-mode"/);
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
