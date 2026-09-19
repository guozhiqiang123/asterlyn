import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVITY_ORDER_KEY,
  ACTIVITY_TOOLS,
  loadActivityOrder,
  moveActivityTool,
  moveActivityToolByOffset,
  normalizeActivityOrder,
  saveActivityOrder,
} from "../src/shell/activity-order.ts";

test("activity order normalization keeps every known tool exactly once", () => {
  assert.deepEqual(normalizeActivityOrder(["changes", "changes", "files", "unknown"]), [
    "changes",
    "files",
    "branches",
    "terminal",
  ]);
  assert.deepEqual(normalizeActivityOrder(null), [...ACTIVITY_TOOLS]);
});

test("activity tools move before or after the hovered tool", () => {
  assert.deepEqual(
    moveActivityTool(ACTIVITY_TOOLS, "changes", "files", "before"),
    ["changes", "files", "branches", "terminal"],
  );
  assert.deepEqual(
    moveActivityTool(ACTIVITY_TOOLS, "files", "branches", "after"),
    ["branches", "files", "changes", "terminal"],
  );
});

test("keyboard offsets clamp at the rail boundaries", () => {
  assert.deepEqual(moveActivityToolByOffset(ACTIVITY_TOOLS, "files", -1), [
    ...ACTIVITY_TOOLS,
  ]);
  assert.deepEqual(moveActivityToolByOffset(ACTIVITY_TOOLS, "branches", 1), [
    "files",
    "changes",
    "branches",
    "terminal",
  ]);
});

test("activity order persists and malformed storage falls back safely", () => {
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
  saveActivityOrder(storage, ["changes", "branches", "files", "terminal"]);
  assert.equal(values.get(ACTIVITY_ORDER_KEY), '["changes","branches","files","terminal"]');
  assert.deepEqual(loadActivityOrder(storage), ["changes", "branches", "files", "terminal"]);
  values.set(ACTIVITY_ORDER_KEY, "not json");
  assert.deepEqual(loadActivityOrder(storage), [...ACTIVITY_TOOLS]);
});
