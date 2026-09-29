import assert from "node:assert/strict";
import test from "node:test";

import { ThemedSelectHost } from "../src/shared/themed-select-host.ts";

test("themed select host releases every window-global listener and observer exactly once", () => {
  const added = [];
  const removed = [];
  let observed = 0;
  let disconnected = 0;
  const previousObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = class {
    observe() { observed += 1; }
    disconnect() { disconnected += 1; }
  };
  const document = {
    documentElement: {},
    addEventListener: (...args) => added.push(["document", ...args]),
    removeEventListener: (...args) => removed.push(["document", ...args]),
  };
  const window = {
    addEventListener: (...args) => added.push(["window", ...args]),
    removeEventListener: (...args) => removed.push(["window", ...args]),
  };
  try {
    const host = new ThemedSelectHost(document, window);
    host.dispose();
    host.dispose();
  } finally {
    globalThis.MutationObserver = previousObserver;
  }

  assert.equal(observed, 1);
  assert.equal(disconnected, 1);
  assert.equal(added.length, 6);
  assert.equal(removed.length, 6);
  assert.deepEqual(
    removed.map(([owner, type]) => [owner, type]),
    added.map(([owner, type]) => [owner, type]),
  );
});

test("bootstrap owns themed-select disposal alongside the app pagehide lifecycle", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/main.ts", import.meta.url), "utf8")
  );
  assert.match(source, /activeRuntime\?\.dispose\(\)/u);
  assert.match(source, /window\.addEventListener\("pagehide", runtime\.dispose/u);
  assert.match(source, /themedSelects\.dispose\(\)/u);
  assert.match(source, /app\.dispose\(\)/u);
});
