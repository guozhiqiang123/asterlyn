import assert from "node:assert/strict";
import test from "node:test";

import { HistoricalFileController } from "../src/features/git-history/historical-file-controller.ts";

const ROOT = "/repo";
const COMMIT = "a".repeat(40);

function document(path = "src/app.ts") {
  return {
    kind: "historical-file",
    repositoryRoot: ROOT,
    repositoryId: ".",
    commitOid: COMMIT,
    path,
    originalPath: null,
    status: "modified",
  };
}

function preview(path = "src/app.ts") {
  return {
    repositoryId: ".",
    commitOid: COMMIT,
    revisionOid: COMMIT,
    path,
    sourcePath: path,
    blobOid: "b".repeat(40),
    fileMode: "100644",
    byteLength: 6,
    kind: "text",
    content: "ready\n",
    utf8Bom: false,
    image: null,
  };
}

test("historical file loading carries the complete immutable change identity", async () => {
  const calls = [];
  const controller = new HistoricalFileController({
    async readCommitFile(root, repositoryId, commitOid, selected) {
      calls.push({ root, repositoryId, commitOid, selected });
      return preview();
    },
  });

  await controller.open(document());

  assert.deepEqual(calls, [{
    root: ROOT,
    repositoryId: ".",
    commitOid: COMMIT,
    selected: { path: "src/app.ts", originalPath: null, status: "modified" },
  }]);
  assert.equal(controller.state.status, "ready");
  assert.equal(controller.state.preview.blobOid, "b".repeat(40));
});

test("a newer historical target rejects an older completion", async () => {
  const pending = [];
  const controller = new HistoricalFileController({
    readCommitFile(_root, _repositoryId, _commitOid, selected) {
      return new Promise((resolve) => pending.push({ selected, resolve }));
    },
  });

  void controller.open(document("first.ts"));
  void controller.open(document("second.ts"));
  pending[0].resolve(preview("first.ts"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.state.status, "loading");
  pending[1].resolve(preview("second.ts"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.state.status, "ready");
  assert.equal(controller.state.preview.path, "second.ts");
});

test("mismatched native identity fails closed and clear invalidates pending work", async () => {
  const pending = [];
  const controller = new HistoricalFileController({
    readCommitFile() {
      return new Promise((resolve) => pending.push(resolve));
    },
  });

  const mismatch = controller.open(document());
  pending.shift()(preview("different.ts"));
  await mismatch;
  assert.equal(controller.state.status, "error");
  assert.match(controller.state.error, /did not match/u);

  void controller.open(document());
  controller.clear();
  pending.shift()(preview());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.state.status, "idle");
});
