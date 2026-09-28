import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  clearDialogGeometry,
  DialogGeometryController,
  dialogGeometryStorageKey,
  fitDialogRect,
  loadDialogGeometry,
  moveDialogRect,
  resizeDialogRect,
  saveDialogGeometry,
} from "../src/shared/dialog-geometry.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const bounds = { width: 1920, height: 1080 };
const minimum = { width: 640, height: 360 };
const initial = { left: 160, top: 90, width: 1600, height: 900 };

test("dialog geometry clamps saved windows to the available layer", () => {
  assert.deepEqual(fitDialogRect(initial, { width: 1100, height: 700 }, minimum), {
    left: 12,
    top: 12,
    width: 1076,
    height: 676,
  });
  assert.deepEqual(
    fitDialogRect({ left: -50, top: -100, width: 200, height: 100 }, bounds, minimum),
    { left: 12, top: 12, width: 640, height: 360 },
  );
});

test("moving a dialog preserves its size and keeps it reachable", () => {
  assert.deepEqual(moveDialogRect(initial, -500, -500, bounds, minimum), {
    left: 12,
    top: 12,
    width: 1600,
    height: 900,
  });
  assert.deepEqual(moveDialogRect(initial, 1000, 1000, bounds, minimum), {
    left: 308,
    top: 168,
    width: 1600,
    height: 900,
  });
});

test("resizing every corner keeps the opposite edges fixed and honors minimums", () => {
  assert.deepEqual(resizeDialogRect(initial, "nw", 300, 200, bounds, minimum), {
    left: 460,
    top: 290,
    width: 1300,
    height: 700,
  });
  assert.deepEqual(resizeDialogRect(initial, "nw", 1500, 1000, bounds, minimum), {
    left: 1120,
    top: 630,
    width: 640,
    height: 360,
  });
  assert.deepEqual(resizeDialogRect(initial, "se", 400, 400, bounds, minimum), {
    left: 160,
    top: 90,
    width: 1748,
    height: 978,
  });
});

test("dialog geometry persists per logical surface and can be reset", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const key = "history-dialog";
  saveDialogGeometry(storage, key, initial);
  assert.equal(values.has(dialogGeometryStorageKey(key)), true);
  assert.deepEqual(loadDialogGeometry(storage, key, bounds, minimum), initial);
  clearDialogGeometry(storage, key);
  assert.equal(loadDialogGeometry(storage, key, bounds, minimum), null);
});

test("Push review migrates its former geometry key", () => {
  const storage = {
    getItem: (key) => key === "asterlyn.push-dialog-geometry" ? JSON.stringify(initial) : null,
  };
  assert.deepEqual(
    loadDialogGeometry(storage, "remote-action-dialog:push-dialog", bounds, minimum),
    initial,
  );
});

test("dialog discovery converges after its own class and handle mutations", async () => {
  const originalMutationObserver = globalThis.MutationObserver;
  let observer = null;
  let mutationNotifications = 0;
  let managedClassWrites = 0;
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      observer = this;
    }

    observe() {}
    disconnect() {}

    notify() {
      mutationNotifications += 1;
      if (mutationNotifications <= 20) this.callback([]);
    }
  }
  globalThis.MutationObserver = FakeMutationObserver;

  const notify = () => observer?.notify();
  const bodyClasses = classList();
  const titlebar = {
    dataset: {},
    tabIndex: -1,
    getAttribute: () => null,
    setAttribute() {},
  };
  const handles = [];
  const layer = {
    id: "remote-action-dialog",
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1400, height: 900 }),
  };
  const dialogClasses = classList(["dialog", "push-dialog"], (name) => {
    if (name === "dialog-geometry-managed") managedClassWrites += 1;
    notify();
  });
  const dialog = {
    classList: dialogClasses,
    dataset: {},
    isConnected: true,
    tagName: "SECTION",
    style: {},
    append(handle) {
      handles.push(handle);
      notify();
    },
    closest(selector) {
      if (selector === ".hidden") return null;
      if (selector.includes("dialog-backdrop") || selector.includes("push-diff-backdrop")) return layer;
      return null;
    },
    contains: () => true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ left: 180, top: 120, width: 1040, height: 660 }),
    hasAttribute: () => false,
    querySelector(selector) {
      if (selector === ".dialog-heading, .command-surface-tabs") return titlebar;
      if (selector.startsWith(":scope > [data-dialog-resize=")) {
        const edge = selector.match(/data-dialog-resize="([^"]+)"/u)?.[1];
        return handles.find((handle) => handle.dataset.dialogResize === edge) ?? null;
      }
      return null;
    },
  };
  const document = {
    addEventListener() {},
    body: { classList: bodyClasses },
    createElement: () => ({
      className: "",
      dataset: {},
      setAttribute() {},
      tabIndex: -1,
    }),
    getElementById: () => null,
    querySelectorAll: () => [dialog],
  };
  const viewport = {
    addEventListener() {},
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    innerHeight: 900,
    innerWidth: 1400,
  };
  const controller = new DialogGeometryController(
    document,
    viewport,
    { getItem: () => null, setItem() {}, removeItem() {} },
    () => ({ move: "Move", resize: "Resize" }),
  );

  try {
    controller.connect();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(managedClassWrites, 1);
    assert.equal(handles.length, 8);
    assert.equal(mutationNotifications, 9);
  } finally {
    controller.dispose();
    globalThis.MutationObserver = originalMutationObserver;
  }
});

test("application code does not fall back to browser-native confirmation prompts", async () => {
  const files = await sourceFiles(path.join(ROOT, "src"));
  const offenders = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (/\bwindow\.confirm\s*\(/u.test(source)) offenders.push(path.relative(ROOT, file));
  }
  assert.deepEqual(offenders, []);
});

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return entry.isFile() && target.endsWith(".ts") ? [target] : [];
  }));
  return nested.flat();
}

function classList(initial = [], onAdd = () => {}) {
  const values = new Set(initial);
  return {
    add(...names) {
      for (const name of names) {
        values.add(name);
        onAdd(name);
      }
    },
    contains: (name) => values.has(name),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    [Symbol.iterator]: () => values[Symbol.iterator](),
  };
}
