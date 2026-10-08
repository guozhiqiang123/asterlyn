import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { adjacentConflictTarget } from "../src/conflict-navigation.ts";

const range = (from) => ({ from, to: from + 1 });
const block = (overrides = {}) => ({
  id: 0,
  base: range(0),
  ours: range(0),
  theirs: range(0),
  result: range(0),
  oursDecision: "pending",
  theirsDecision: "pending",
  oursChanged: true,
  theirsChanged: true,
  sameSideContent: false,
  automaticallyResolved: false,
  manuallyEdited: false,
  ...overrides,
});

test("conflict navigation skips one-sided and identical changes", () => {
  const blocks = [
    block({ id: 0, oursChanged: true, theirsChanged: false, result: range(10) }),
    block({ id: 1, sameSideContent: true, result: range(20) }),
    block({ id: 2, result: range(42) }),
    block({ id: 3, oursChanged: false, theirsChanged: true, result: range(60) }),
    block({ id: 4, result: range(96) }),
  ];

  assert.deepEqual(adjacentConflictTarget(blocks, -1, 1), { index: 2, position: 42 });
  assert.deepEqual(adjacentConflictTarget(blocks, -1, -1), { index: 4, position: 96 });
  assert.deepEqual(adjacentConflictTarget(blocks, 2, 1), { index: 4, position: 96 });
  assert.deepEqual(adjacentConflictTarget(blocks, 4, -1), { index: 2, position: 42 });
  assert.equal(adjacentConflictTarget(blocks, 4, 1), null);
  assert.equal(adjacentConflictTarget(blocks, 2, -1), null);
});

test("conflict navigation reports no target when a file has no two-sided conflict", () => {
  const blocks = [
    block({ oursChanged: true, theirsChanged: false }),
    block({ sameSideContent: true }),
  ];
  assert.equal(adjacentConflictTarget(blocks, -1, 1), null);
  assert.equal(adjacentConflictTarget(blocks, -1, -1), null);
});

test("conflict editor scrolls the Result code position as the single navigation anchor", async () => {
  const source = await readFile(new URL("../src/conflict-editor.ts", import.meta.url), "utf8");
  const method = source.slice(source.indexOf("  navigateChange("), source.indexOf("\n  requestMeasure()"));

  assert.match(method, /adjacentConflictTarget\(blocks, this\.activeReviewBlock, direction\)/u);
  assert.match(method, /const result = this\.leftMerge\?\.b;/u);
  assert.match(method, /EditorView\.scrollIntoView\(position, \{ y: "center" \}\)/u);
  assert.equal(method.match(/\.dispatch\(/gu)?.length, 1);
  assert.doesNotMatch(method, /leftMerge\.a|rightMerge/u);
});

test("opening a conflict moves the review directly to its first actionable block", async () => {
  const source = await readFile(new URL("../src/conflict-editor.ts", import.meta.url), "utf8");
  assert.match(source, /requestAnimationFrame\(\(\) => \{[\s\S]*this\.activeReviewBlock < 0[\s\S]*this\.navigateChange\(1\)/u);
});
