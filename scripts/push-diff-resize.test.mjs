import assert from "node:assert/strict";
import test from "node:test";

import { fitPushDiffRect, resizePushDiffRect } from "../src/features/remote-push/push-diff-resize.ts";

const bounds = { width: 1920, height: 1080 };
const initial = { left: 160, top: 90, width: 1600, height: 900 };

test("pushed-file Diff remains visible after its window shrinks", () => {
  assert.deepEqual(fitPushDiffRect(initial, { width: 1100, height: 700 }), {
    left: 12, top: 12, width: 1076, height: 676,
  });
});

test("dragging west and north edges keeps opposite edges fixed", () => {
  assert.deepEqual(resizePushDiffRect(initial, "nw", 300, 200, bounds), {
    left: 460, top: 290, width: 1300, height: 700,
  });
  assert.deepEqual(resizePushDiffRect(initial, "nw", 1500, 1000, bounds), {
    left: 1120, top: 630, width: 640, height: 360,
  });
});

test("dragging east and south edges is clamped to the viewport", () => {
  assert.deepEqual(resizePushDiffRect(initial, "se", 400, 400, bounds), {
    left: 160, top: 90, width: 1748, height: 978,
  });
});
