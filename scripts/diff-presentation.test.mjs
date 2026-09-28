import assert from "node:assert/strict";
import test from "node:test";

import { parseUnifiedDiff, splitUnifiedDiff } from "../src/diff-presentation.ts";

test("source diff removes patch syntax and keeps real line numbers", () => {
  const patch = [
    "diff --git a/file.txt b/file.txt",
    "index 1111111..2222222 100644",
    "--- a/file.txt",
    "+++ b/file.txt",
    "@@ -10,4 +10,5 @@",
    " context",
    "-old one",
    "-old two",
    "+new one",
    "+new two",
    "+new three",
    " tail",
  ].join("\n");

  const split = splitUnifiedDiff(patch);
  assert.equal(split.oldDocument.includes("diff --git"), false);
  assert.equal(split.newDocument.includes("@@"), false);
  assert.equal(split.rows[0].kind, "omitted");
  assert.equal(split.rows[1].old.lineNumber, 10);
  assert.equal(split.rows[2].old.text, "old one");
  assert.equal(split.rows[2].new.text, "new one");
  assert.equal(split.rows[2].old.lineNumber, 11);
  assert.equal(split.rows[2].new.lineNumber, 11);
  assert.equal(split.rows[4].old.lineNumber, null);
  assert.equal(split.rows[4].new.lineNumber, 13);
  assert.equal(split.rows[5].old.lineNumber, 13);
  assert.equal(split.rows[5].new.lineNumber, 14);
});

test("source diff aligns addition-only and deletion-only blocks", () => {
  const split = splitUnifiedDiff(
    [
      "@@ -1,3 +1,3 @@",
      " same",
      "+added",
      " same again",
      "-removed",
    ].join("\n"),
  );
  assert.deepEqual(
    split.rows.map((row) => [row.kind, row.old.text, row.new.text]),
    [
      ["context", "same", "same"],
      ["added", "", "added"],
      ["context", "same again", "same again"],
      ["removed", "removed", ""],
    ],
  );
});

test("source diff exposes omitted ranges and no-newline markers", () => {
  const split = splitUnifiedDiff(
    [
      "@@ -8 +8 @@",
      "-before",
      "\\ No newline at end of file",
      "+after",
      "\\ No newline at end of file",
      "@@ -30 +30 @@",
      " context",
    ].join("\n"),
  );
  assert.equal(split.rows[0].old.text, "⋯ 7 unchanged lines omitted ⋯");
  assert.deepEqual(
    split.rows[2],
    {
      kind: "notice",
      old: { lineNumber: null, text: "No newline at end of file", changed: [] },
      new: { lineNumber: null, text: "No newline at end of file", changed: [] },
    },
  );
  assert.equal(split.rows[3].kind, "omitted");
  assert.equal(split.rows[4].old.lineNumber, 30);
});

test("source diff expands replacements to presentation-oriented word ranges", () => {
  const split = splitUnifiedDiff(
    ["@@ -1 +1 @@", "-const answer = oldValue;", "+const answer = newValue;"].join(
      "\n",
    ),
  );
  assert.equal(split.rows[0].kind, "modified");
  assert.deepEqual(split.rows[0].old.changed, [
    { from: 15, to: 23, kind: "modified" },
  ]);
  assert.deepEqual(split.rows[0].new.changed, [
    { from: 15, to: 23, kind: "modified" },
  ]);
});

test("source diff retains multiple separated inline replacements", () => {
  const split = splitUnifiedDiff(
    ["@@ -1 +1 @@", "-foo = oldA + oldB", "+foo = newA + newB"].join("\n"),
  );
  assert.deepEqual(split.rows[0].old.changed, [
    { from: 6, to: 10, kind: "modified" },
    { from: 13, to: 17, kind: "modified" },
  ]);
  assert.deepEqual(split.rows[0].new.changed, [
    { from: 6, to: 10, kind: "modified" },
    { from: 13, to: 17, kind: "modified" },
  ]);
});

test("source diff marks complete replacements and one-sided inline insertions", () => {
  const replaced = splitUnifiedDiff(
    ["@@ -1 +1 @@", "-abc", "+xyz"].join("\n"),
  );
  assert.deepEqual(replaced.rows[0].old.changed, [
    { from: 0, to: 3, kind: "modified" },
  ]);
  assert.deepEqual(replaced.rows[0].new.changed, [
    { from: 0, to: 3, kind: "modified" },
  ]);

  const inserted = splitUnifiedDiff(
    ["@@ -1 +1 @@", "-call(foo)", "+call(foo, bar)"].join("\n"),
  );
  assert.deepEqual(inserted.rows[0].old.changed, []);
  assert.deepEqual(inserted.rows[0].new.changed, [
    { from: 8, to: 13, kind: "added" },
  ]);

  const removed = splitUnifiedDiff(
    ["@@ -1 +1 @@", "-call(foo, bar)", "+call(foo)"].join("\n"),
  );
  assert.deepEqual(removed.rows[0].old.changed, [
    { from: 8, to: 13, kind: "removed" },
  ]);
  assert.deepEqual(removed.rows[0].new.changed, []);
});

test("source diff keeps long and Unicode lines eligible for exact ranges", () => {
  const prefix = "x".repeat(600);
  const split = splitUnifiedDiff(
    [
      "@@ -1 +1 @@",
      `-${prefix} oldValue 😀`,
      `+${prefix} newValue 😎`,
    ].join("\n"),
  );
  assert.deepEqual(split.rows[0].old.changed, [{
    from: prefix.length + 1,
    to: prefix.length + 12,
    kind: "modified",
  }]);
  assert.deepEqual(split.rows[0].new.changed, [{
    from: prefix.length + 1,
    to: prefix.length + 12,
    kind: "modified",
  }]);
});

test("source diff aligns a leading inserted line before later replacements", () => {
  const split = splitUnifiedDiff(
    [
      "@@ -1,2 +1,3 @@",
      "-alpha",
      "-beta",
      "+intro",
      "+alpha2",
      "+beta2",
    ].join("\n"),
  );
  assert.deepEqual(
    split.rows.map((row) => [row.kind, row.old.text, row.new.text]),
    [
      ["added", "", "intro"],
      ["modified", "alpha", "alpha2"],
      ["modified", "beta", "beta2"],
    ],
  );
  assert.deepEqual(split.rows[1].new.changed, [
    { from: 5, to: 6, kind: "added" },
  ]);
});

test("source diff aligns an inserted middle line without shifting later replacements", () => {
  const split = splitUnifiedDiff(
    [
      "@@ -1,2 +1,3 @@",
      "-alpha",
      "-beta",
      "+alpha2",
      "+inserted middle",
      "+beta2",
    ].join("\n"),
  );
  assert.deepEqual(
    split.rows.map((row) => [row.kind, row.old.text, row.new.text]),
    [
      ["modified", "alpha", "alpha2"],
      ["added", "", "inserted middle"],
      ["modified", "beta", "beta2"],
    ],
  );
});

test("unified diff keeps removed and added rows while sharing precise ranges", () => {
  const unified = parseUnifiedDiff(
    ["@@ -1 +1 @@", "-foo = oldA + oldB", "+foo = newA + newB"].join("\n"),
  );
  assert.deepEqual(unified.rows.map((row) => row.kind), ["removed", "added"]);
  assert.deepEqual(unified.rows[0].changed, [
    { from: 6, to: 10, kind: "modified" },
    { from: 13, to: 17, kind: "modified" },
  ]);
  assert.deepEqual(unified.rows[1].changed, [
    { from: 6, to: 10, kind: "modified" },
    { from: 13, to: 17, kind: "modified" },
  ]);
});

test("hunk content that resembles file markers remains source text", () => {
  const split = splitUnifiedDiff(
    ["--- a/file.txt", "+++ b/file.txt", "@@ -1 +1 @@", "--- old", "+++ new"].join(
      "\n",
    ),
  );
  assert.equal(split.rows[0].old.text, "-- old");
  assert.equal(split.rows[0].new.text, "++ new");
});

test("binary patches show an honest notice instead of patch metadata", () => {
  const split = splitUnifiedDiff(
    [
      "diff --git a/image.png b/image.png",
      "index 1111111..2222222 100644",
      "Binary files a/image.png and b/image.png differ",
    ].join("\n"),
  );
  assert.equal(split.rows.length, 1);
  assert.equal(split.rows[0].kind, "notice");
  assert.equal(split.rows[0].old.text, "Binary files a/image.png and b/image.png differ");
});
