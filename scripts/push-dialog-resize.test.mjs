import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultPushDialogRect,
  fitPushDialogRect,
  loadPushDialogGeometry,
  resizePushDialogRect,
  savePushDialogGeometry,
  PUSH_DIALOG_GEOMETRY_KEY,
} from "../src/features/remote-push/push-dialog-resize.ts";

const bounds = { width: 1920, height: 1080 };
const initial = { left: 420, top: 200, width: 1080, height: 680 };

test("default push dialog rect centers a standard size within viewport", () => {
  const result = defaultPushDialogRect(bounds);
  assert.equal(result.width, 1080);
  assert.equal(result.height, 680);
  assert.equal(result.left, Math.round((1920 - 1080) / 2));
  assert.equal(result.top, Math.round((1080 - 680) / 2));
});

test("default push dialog rect clamps to smaller viewports", () => {
  const small = defaultPushDialogRect({ width: 800, height: 500 });
  assert.equal(small.width, 800 - 24);
  assert.equal(small.height, 500 - 24);
  assert.equal(small.left, 12);
  assert.equal(small.top, 12);
});

test("fitPushDialogRect clamps geometry within viewport and enforces minimums", () => {
  const fitted = fitPushDialogRect({ left: -50, top: -100, width: 2000, height: 1200 }, bounds);
  assert.equal(fitted.left, 12);
  assert.equal(fitted.top, 12);
  assert.equal(fitted.width, 1920 - 24);
  assert.equal(fitted.height, 1080 - 24);

  const tiny = fitPushDialogRect({ left: 100, top: 100, width: 200, height: 200 }, bounds);
  assert.equal(tiny.width, 640);
  assert.equal(tiny.height, 420);
});

test("dragging push dialog edges and corners adjusts geometry accurately", () => {
  const se = resizePushDialogRect(initial, "se", 100, 50, bounds);
  assert.equal(se.left, 420);
  assert.equal(se.top, 200);
  assert.equal(se.width, 1180);
  assert.equal(se.height, 730);

  const nw = resizePushDialogRect(initial, "nw", 50, 40, bounds);
  assert.equal(nw.left, 470);
  assert.equal(nw.top, 240);
  assert.equal(nw.width, 1030);
  assert.equal(nw.height, 640);
});

test("loadPushDialogGeometry restores persisted history from storage", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, val) => store.set(key, String(val)),
  };

  const fresh = loadPushDialogGeometry(storage, bounds);
  assert.deepEqual(fresh, defaultPushDialogRect(bounds));

  const custom = { left: 200, top: 150, width: 1200, height: 750 };
  savePushDialogGeometry(storage, custom);
  assert.equal(store.has(PUSH_DIALOG_GEOMETRY_KEY), true);

  const restored = loadPushDialogGeometry(storage, bounds);
  assert.deepEqual(restored, custom);
});

test("loadPushDialogGeometry falls back to default on corrupt storage", () => {
  const storage = {
    getItem: () => "invalid json",
    setItem: () => {},
  };
  const result = loadPushDialogGeometry(storage, bounds);
  assert.deepEqual(result, defaultPushDialogRect(bounds));
});
