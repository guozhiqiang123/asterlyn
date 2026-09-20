import assert from "node:assert/strict";
import test from "node:test";

import {
  EditorChangeBaselineController,
} from "../src/features/files-editor/editor-change-baseline-controller.ts";

test("editor baselines deduplicate exact changed-file reads", async () => {
  const pending = Promise.withResolvers();
  const reads = [];
  const controller = new EditorChangeBaselineController({
    readWorkingDiffBase: (root, change) => {
      reads.push([root, change.path]);
      return pending.promise;
    },
  });
  const changes = [];
  controller.subscribe((change) => changes.push(change.path));
  controller.installSnapshot(snapshot("a", modified("src/app.ts")));
  controller.load("src/app.ts");
  controller.load("src/app.ts");
  assert.deepEqual(reads, [["/repo", "src/app.ts"]]);
  pending.resolve(base("src/app.ts", "from HEAD"));
  await pending.promise;
  await Promise.resolve();
  assert.equal(controller.content("src/app.ts"), "from HEAD");
  assert.deepEqual(changes, ["src/app.ts"]);
});

test("a moved HEAD rejects an older baseline completion", async () => {
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  let read = 0;
  const controller = new EditorChangeBaselineController({
    readWorkingDiffBase: () => ++read === 1 ? first.promise : second.promise,
  });
  controller.installSnapshot(snapshot("a", modified("src/app.ts")));
  controller.load("src/app.ts");
  controller.installSnapshot(snapshot("b", modified("src/app.ts")));
  controller.load("src/app.ts");
  first.resolve(base("src/app.ts", "stale"));
  await first.promise;
  await Promise.resolve();
  assert.equal(controller.content("src/app.ts"), null);
  second.resolve(base("src/app.ts", "current"));
  await second.promise;
  await Promise.resolve();
  assert.equal(controller.content("src/app.ts"), "current");
});

test("unchanged, deleted, conflicted, and submodule paths do not request baselines", () => {
  let reads = 0;
  const controller = new EditorChangeBaselineController({
    async readWorkingDiffBase() { reads += 1; return base("x", ""); },
  });
  controller.installSnapshot(snapshot("a",
    { ...modified("deleted"), worktreeStatus: "deleted" },
    { ...modified("conflict"), conflicted: true },
    { ...modified("module"), submodule: true },
  ));
  for (const path of ["missing", "deleted", "conflict", "module"]) controller.load(path);
  assert.equal(reads, 0);
});

function snapshot(oid, ...changes) {
  return {
    root: "/repo", gitDir: "/repo/.git", branch: { oid }, changes,
  };
}

function modified(path) {
  return {
    path, originalPath: null, indexStatus: "unmodified", worktreeStatus: "modified",
    conflicted: false, submodule: false,
  };
}

function base(path, content) {
  return { path, originalPath: null, headOid: "a", blobOid: "b", content, utf8Bom: false, byteLength: content.length };
}
