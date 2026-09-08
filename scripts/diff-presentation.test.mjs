import assert from "node:assert/strict";
import test from "node:test";

import { splitUnifiedDiff } from "../src/diff-presentation.ts";

test("split diff aligns replacement blocks and preserves metadata", () => {
  const patch = [
    "diff --git a/file.txt b/file.txt",
    "index 1111111..2222222 100644",
    "--- a/file.txt",
    "+++ b/file.txt",
    "@@ -1,3 +1,4 @@",
    " context",
    "-old one",
    "-old two",
    "+new one",
    "+new two",
    "+new three",
    " tail",
    "",
  ].join("\n");

  const split = splitUnifiedDiff(patch);
  const oldLines = split.oldDocument.split("\n");
  const newLines = split.newDocument.split("\n");
  assert.equal(oldLines.length, newLines.length);
  assert.equal(oldLines[2], "--- a/file.txt");
  assert.equal(newLines[2], "");
  assert.equal(oldLines[3], "");
  assert.equal(newLines[3], "+++ b/file.txt");
  assert.deepEqual(oldLines.slice(6, 9), ["-old one", "-old two", ""]);
  assert.deepEqual(newLines.slice(6, 9), ["+new one", "+new two", "+new three"]);
  assert.equal(oldLines[9], " tail");
  assert.equal(newLines[9], " tail");
});

test("split diff aligns addition-only and deletion-only blocks", () => {
  const patch = [
    "@@ -1 +1,2 @@",
    " same",
    "+added",
    " same again",
    "-removed",
    "--- removed content beginning with dashes",
  ].join("\n");

  const split = splitUnifiedDiff(patch);
  assert.deepEqual(split.oldDocument.split("\n"), [
    "@@ -1 +1,2 @@",
    " same",
    "",
    " same again",
    "-removed",
    "--- removed content beginning with dashes",
  ]);
  assert.deepEqual(split.newDocument.split("\n"), [
    "@@ -1 +1,2 @@",
    " same",
    "+added",
    " same again",
    "",
    "",
  ]);
});

test("split diff keeps no-newline markers on their source side", () => {
  const patch = [
    "@@ -1 +1 @@",
    "-before",
    "\\ No newline at end of file",
    "+after",
    "\\ No newline at end of file",
  ].join("\n");

  const split = splitUnifiedDiff(patch);
  assert.deepEqual(split.oldDocument.split("\n"), [
    "@@ -1 +1 @@",
    "-before",
    "\\ No newline at end of file",
  ]);
  assert.deepEqual(split.newDocument.split("\n"), [
    "@@ -1 +1 @@",
    "+after",
    "\\ No newline at end of file",
  ]);
});

test("split diff does not confuse hunk content with file markers", () => {
  const split = splitUnifiedDiff(
    ["--- a/file.txt", "+++ b/file.txt", "@@ -1 +1 @@", "--- old", "+++ new"].join(
      "\n",
    ),
  );
  assert.deepEqual(split.oldDocument.split("\n"), [
    "--- a/file.txt",
    "",
    "@@ -1 +1 @@",
    "--- old",
  ]);
  assert.deepEqual(split.newDocument.split("\n"), [
    "",
    "+++ b/file.txt",
    "@@ -1 +1 @@",
    "+++ new",
  ]);
});
