import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ConflictResolutionModel } from "../src/conflict-resolution-model.ts";
import { parseUnifiedDiff, splitUnifiedDiff } from "../src/diff-presentation.ts";

const PATCH = [
  "diff --git a/src/example.ts b/src/example.ts",
  "index 1111111..2222222 100644",
  "--- a/src/example.ts",
  "+++ b/src/example.ts",
  "@@ -1,5 +1,6 @@",
  " keep",
  "-replace me",
  "+replacement",
  "+inserted",
  " keep too",
  "-deleted",
  " tail",
].join("\n");

test("read-only split and unified projections retain the same meaningful changes", () => {
  const split = splitUnifiedDiff(PATCH);
  const unified = parseUnifiedDiff(PATCH);

  assert.deepEqual(
    split.rows.filter((row) => row.kind !== "context").map((row) => row.kind),
    ["modified", "added", "removed"],
  );
  assert.deepEqual(
    unified.rows.filter((row) => row.kind !== "context").map((row) => row.kind),
    ["removed", "added", "added", "removed"],
  );
  assert.match(split.oldDocument, /replace me/);
  assert.match(split.newDocument, /replacement\ninserted/);
});

test("conflict blocks stay Base-anchored across replacement, insertion, and deletion fixtures", () => {
  const fixtures = [
    {
      base: "start\nbase\nend\n",
      ours: "start\nours\nend\n",
      theirs: "start\ntheirs\nend\n",
      expectedBlocks: 1,
    },
    {
      base: "start\nend\n",
      ours: "start\nours\nend\n",
      theirs: "start\ntheirs\nend\n",
      expectedBlocks: 1,
    },
    {
      base: "start\nbase\nend\n",
      ours: "start\nend\n",
      theirs: "start\ntheirs\nend\n",
      expectedBlocks: 1,
    },
  ];

  for (const fixture of fixtures) {
    const snapshots = ConflictResolutionModel.create(
      fixture.base,
      fixture.ours,
      fixture.theirs,
      fixture.base,
    ).snapshots();
    assert.equal(snapshots.length, fixture.expectedBlocks);
    assert.ok(snapshots.every((block, index) => block.id === index));
    assert.ok(snapshots.every((block) => block.base.from <= block.base.to));
    assert.ok(snapshots.every((block) => block.result.from <= block.result.to));
  }
});

test("identical two-sided content and one-sided content keep independent decisions", () => {
  const identical = ConflictResolutionModel.create("base", "same", "same", "base").snapshots();
  assert.equal(identical.length, 1);
  assert.equal(identical[0].oursDecision, "pending");
  assert.equal(identical[0].theirsDecision, "pending");

  const oneSided = ConflictResolutionModel.create("base", "ours", "base", "base");
  const block = oneSided.snapshots()[0];
  assert.equal(oneSided.hasChanges("ours", block.ours), true);
  assert.equal(oneSided.hasChanges("theirs", block.theirs), false);
});

test("large unchanged gaps, long lines, and exact trailing content remain bounded inputs", () => {
  const prefix = Array.from({ length: 80 }, (_, index) => `prefix ${index}`).join("\n");
  const suffix = Array.from({ length: 80 }, (_, index) => `suffix ${index}`).join("\n");
  const long = "x".repeat(16_384);
  const base = `${prefix}\nbase ${long}\n${suffix}`;
  const model = ConflictResolutionModel.create(
    base,
    `${prefix}\nours ${long}\n${suffix}`,
    `${prefix}\ntheirs ${long}\n${suffix}`,
    base,
  );

  assert.equal(model.snapshots().length, 1);
  assert.ok(model.snapshots()[0].base.from > 0);
  assert.ok(model.snapshots()[0].base.to < base.length);
});

test("surface ownership keeps read-only Diff immutable and exposes only one writable conflict Result", async () => {
  const [readOnly, editable, conflict] = await Promise.all([
    readFile(new URL("../src/diff-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/editable-diff-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/conflict-editor.ts", import.meta.url), "utf8"),
  ]);

  assert.match(readOnly, /EditorState\.readOnly\.of\(true\)/u);
  assert.match(readOnly, /EditorView\.editable\.of\(false\)/u);
  assert.match(editable, /revertControls: "a-to-b"/u);
  assert.match(conflict, /resultSide === "primary"[\s\S]*EditorState\.readOnly/u);
  assert.match(conflict, /resultSide === "primary"[\s\S]*EditorView\.editable/u);
  assert.equal(conflict.match(/new MergeView\(/g)?.length, 2);
});

