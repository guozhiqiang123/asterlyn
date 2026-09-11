import assert from "node:assert/strict";
import test from "node:test";

import {
  adjacentDiffItem,
  splitChangeStartLines,
  unifiedChangeStartLines,
} from "../src/workbench/diff-navigation.ts";
import { editorDocumentKey } from "../src/workbench/editor-document.ts";

test("unified Diff navigation groups adjacent removed and added lines", () => {
  const patch = [
    "diff --git a/file.ts b/file.ts",
    "--- a/file.ts",
    "+++ b/file.ts",
    "@@ -1,4 +1,4 @@",
    " same",
    "-old",
    "+new",
    " same",
    "@@ -20,2 +20,2 @@",
    "-before",
    "+after",
  ].join("\n");
  assert.deepEqual(unifiedChangeStartLines(patch), [6, 10]);
});

test("split Diff navigation uses the first row of each change group", () => {
  const side = { lineNumber: 1, text: "", changed: [] };
  const rows = [
    { kind: "omitted", old: side, new: side },
    { kind: "removed", old: side, new: side },
    { kind: "modified", old: side, new: side },
    { kind: "context", old: side, new: side },
    { kind: "added", old: side, new: side },
  ];
  assert.deepEqual(splitChangeStartLines(rows), [2, 5]);
});

test("file navigation stops at collection boundaries", () => {
  const files = ["a", "b", "c"];
  assert.equal(adjacentDiffItem(files, "b", -1), "a");
  assert.equal(adjacentDiffItem(files, "b", 1), "c");
  assert.equal(adjacentDiffItem(files, "a", -1), null);
  assert.equal(adjacentDiffItem(files, "c", 1), null);
  assert.equal(adjacentDiffItem(files, "missing", 1), null);
});

test("Diff document identities isolate source kind, side, repository, and revision", () => {
  const working = editorDocumentKey({
    kind: "working-diff",
    repositoryRoot: "/repo",
    selection: { path: "src/file.ts", staged: false },
  });
  const staged = editorDocumentKey({
    kind: "working-diff",
    repositoryRoot: "/repo",
    selection: { path: "src/file.ts", staged: true },
  });
  const commit = editorDocumentKey({
    kind: "commit-diff",
    repositoryRoot: "/repo",
    repositoryId: ".",
    oid: "a".repeat(40),
    path: "src/file.ts",
  });
  const otherCommit = editorDocumentKey({
    kind: "commit-diff",
    repositoryRoot: "/repo",
    repositoryId: ".",
    oid: "b".repeat(40),
    path: "src/file.ts",
  });

  assert.equal(new Set([working, staged, commit, otherCommit]).size, 4);
});
