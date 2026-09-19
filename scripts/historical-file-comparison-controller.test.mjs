import assert from "node:assert/strict";
import test from "node:test";

import { HistoricalFileComparisonController } from "../src/features/git-history/historical-file-comparison-controller.ts";

const ROOT = "/repo";
const COMMIT = "a".repeat(40);

function document(currentSource = "disk") {
  return {
    kind: "historical-file-comparison",
    repositoryRoot: ROOT,
    repositoryId: ".",
    commitOid: COMMIT,
    path: "src/app.ts",
    originalPath: "src/old.ts",
    status: "renamed",
    currentSource,
  };
}

function comparison(currentSource = "disk") {
  return {
    repositoryId: ".",
    commitOid: COMMIT,
    revisionOid: COMMIT,
    path: "src/app.ts",
    sourcePath: "src/app.ts",
    blobOid: "b".repeat(40),
    fileMode: "100644",
    currentRevision: "c".repeat(64),
    currentSource,
    currentByteLength: 8,
    kind: "text",
    patch: "diff --git a/src/app.ts b/src/app.ts\n",
    image: null,
    truncated: false,
  };
}

test("disk comparison carries the complete commit change and no buffer payload", async () => {
  const calls = [];
  const controller = new HistoricalFileComparisonController({
    async compareCommitFileToCurrent(...args) {
      calls.push(args);
      return comparison();
    },
  });

  await controller.open(document(), null);

  assert.deepEqual(calls, [[
    ROOT,
    ".",
    COMMIT,
    { path: "src/app.ts", originalPath: "src/old.ts", status: "renamed" },
    null,
    null,
  ]]);
  assert.equal(controller.state.status, "ready");
});

test("unsaved comparison rejects a buffer changed during the native request", async () => {
  let resolve;
  let current = true;
  const controller = new HistoricalFileComparisonController({
    compareCommitFileToCurrent() {
      return new Promise((complete) => { resolve = complete; });
    },
  });
  const pending = controller.open(document("buffer"), {
    content: "unsaved\n",
    expectedRevision: "d".repeat(64),
    current: () => current,
  });
  current = false;
  resolve(comparison("buffer"));
  await pending;

  assert.equal(controller.state.status, "error");
  assert.match(controller.state.error, /buffer changed/u);
});

test("new targets and mismatched native identities fail closed", async () => {
  const pending = [];
  const controller = new HistoricalFileComparisonController({
    compareCommitFileToCurrent(_root, _repository, _commit, selected) {
      return new Promise((resolve) => pending.push({ selected, resolve }));
    },
  });
  void controller.open(document(), null);
  void controller.open({ ...document(), path: "src/other.ts", originalPath: null }, null);
  pending[0].resolve(comparison());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.state.status, "loading");
  pending[1].resolve(comparison());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.state.status, "error");
  assert.match(controller.state.error, /did not match/u);
});
