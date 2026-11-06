import assert from "node:assert/strict";
import test from "node:test";
import { DiffReviewViewportIndex } from "../src/shared/diff-review/diff-review-viewport.ts";

const block = (id, before, after = before) => ({ id, kind: "modified", status: "readonly", actions: [], ranges: {before, after} });
const ids = (blocks) => blocks.map((b) => b.id);

test("viewport index retains spanning, nested, point and independently scrolled pane ranges", () => {
  const spanning = block("spanning", {from: 0, to: 900}, null);
  const point = block("point", {from: 50, to: 50}, {from: 800, to: 800});
  const nested = block("nested", {from: 20, to: 30});
  const distant = block("distant", {from: 1000, to: 1100}, {from: 50, to: 60});
  const index = new DiffReviewViewportIndex([distant, point, nested, spanning]);
  assert.deepEqual(ids(index.intersecting("before", 45, 55)), ["spanning", "point"]);
  assert.deepEqual(ids(index.intersecting("before", 50, 50)), ["spanning", "point"]);
  assert.deepEqual(ids(index.intersecting("after", 45, 55)), ["distant"]);
  assert.deepEqual(index.intersecting("result", 0, 2000), []);
  assert.deepEqual(index.intersecting("before", 1200, 1300), []);
});

test("viewport index limits a long sparse Diff to nearby changes and snapshots replace stale ranges", () => {
  const blocks = Array.from({length: 10000}, (_, i) => block(String(i), {from: i * 100, to: i * 100 + 10}));
  assert.deepEqual(ids(new DiffReviewViewportIndex(blocks).intersecting("before", 500000, 500250)), ["5000", "5001", "5002"]);
  assert.deepEqual(new DiffReviewViewportIndex([]).intersecting("before", 500000, 500250), []);
});
