import assert from "node:assert/strict";
import test from "node:test";

import { HistoryComparisonController } from "../src/features/git-history/history-comparison-controller.ts";

const ROOT = "/repo";
const NEWER = "1".repeat(40);
const OLDER = "2".repeat(40);

function request(anchorOid = NEWER, activeOid = OLDER) {
  return {
    workspaceRoot: ROOT,
    workspaceGeneration: 4,
    repositoryRevision: 9,
    repositoryId: ".",
    anchorOid,
    activeOid,
  };
}

function details(beforeOid, afterOid, relation = "beforeIsAncestor") {
  return {
    repositoryId: ".",
    beforeOid,
    afterOid,
    relation,
    files: [{ path: "src/app.ts", originalPath: null, status: "modified" }],
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("comparison auto-orients an ancestor hidden behind the active endpoint", async () => {
  const calls = [];
  const controller = new HistoryComparisonController({
    async readCommitComparisonDetails(root, repositoryId, beforeOid, afterOid) {
      calls.push({ root, repositoryId, beforeOid, afterOid });
      return calls.length === 1
        ? details(beforeOid, afterOid, "afterIsAncestor")
        : details(beforeOid, afterOid, "beforeIsAncestor");
    },
  });

  controller.open(request());
  await settle();

  assert.deepEqual(calls.map(({ beforeOid, afterOid }) => [beforeOid, afterOid]), [
    [NEWER, OLDER],
    [OLDER, NEWER],
  ]);
  assert.equal(controller.state.status, "ready");
  assert.equal(controller.state.details.beforeOid, OLDER);
  assert.equal(controller.state.details.afterOid, NEWER);
});

test("explicit swap keeps the requested direction and exact file selection", async () => {
  const calls = [];
  const controller = new HistoryComparisonController({
    async readCommitComparisonDetails(_root, _repositoryId, beforeOid, afterOid) {
      calls.push([beforeOid, afterOid]);
      return details(
        beforeOid,
        afterOid,
        beforeOid === OLDER ? "beforeIsAncestor" : "afterIsAncestor",
      );
    },
  });

  controller.open(request(OLDER, NEWER));
  await settle();
  assert.equal(controller.selectFile("src/app.ts")?.path, "src/app.ts");
  assert.equal(controller.swap(), true);
  await settle();

  assert.deepEqual(calls, [[OLDER, NEWER], [NEWER, OLDER]]);
  assert.equal(controller.state.details.beforeOid, NEWER);
  assert.equal(controller.state.details.afterOid, OLDER);
  assert.equal(controller.state.selectedFile, "src/app.ts");
  assert.equal(controller.selectFile("missing.ts"), null);
});

test("retry preserves a failed explicit swap direction", async () => {
  let callCount = 0;
  const directions = [];
  const controller = new HistoryComparisonController({
    async readCommitComparisonDetails(_root, _repositoryId, beforeOid, afterOid) {
      callCount += 1;
      directions.push([beforeOid, afterOid]);
      if (callCount === 2) throw new Error("temporary failure");
      return details(
        beforeOid,
        afterOid,
        beforeOid === OLDER ? "beforeIsAncestor" : "afterIsAncestor",
      );
    },
  });

  controller.open(request(OLDER, NEWER));
  await settle();
  controller.swap();
  await settle();
  assert.equal(controller.state.status, "error");
  assert.equal(controller.state.beforeOid, NEWER);
  assert.equal(controller.state.afterOid, OLDER);
  assert.equal(controller.retry(), true);
  await settle();

  assert.deepEqual(directions, [[OLDER, NEWER], [NEWER, OLDER], [NEWER, OLDER]]);
  assert.equal(controller.state.details.beforeOid, NEWER);
  assert.equal(controller.state.details.afterOid, OLDER);
});

test("a newer comparison rejects an older completion", async () => {
  const pending = [];
  const controller = new HistoryComparisonController({
    readCommitComparisonDetails(_root, _repositoryId, beforeOid, afterOid) {
      return new Promise((resolve) => pending.push({ beforeOid, afterOid, resolve }));
    },
  });
  const other = "3".repeat(40);

  controller.open(request(OLDER, NEWER));
  controller.open(request(OLDER, other));
  pending[0].resolve(details(OLDER, NEWER));
  await settle();
  assert.equal(controller.state.status, "loading");
  pending[1].resolve(details(OLDER, other));
  await settle();
  assert.equal(controller.state.details.afterOid, other);
});
