import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { scheduleEditorRuntimePreload } from "../src/features/files-editor/editor-runtime-preload.ts";

function fakeScheduler() {
  const callbacks = [];
  return {
    callbacks,
    scheduler: { request: (callback) => callbacks.push(callback) },
    run() {
      const pending = callbacks.splice(0);
      for (const callback of pending) callback();
    },
  };
}

test("the editor runtimes warm on the scheduled idle moment instead of the open path", () => {
  const { scheduler, run } = fakeScheduler();
  let preloads = 0;
  scheduleEditorRuntimePreload({ preloadRuntimes: () => { preloads += 1; } }, scheduler);
  assert.equal(preloads, 0);
  run();
  assert.equal(preloads, 1);
  run();
  assert.equal(preloads, 1);
});

test("a cancelled preload never warms the runtimes", () => {
  const { scheduler, run } = fakeScheduler();
  let preloads = 0;
  const cancel = scheduleEditorRuntimePreload(
    { preloadRuntimes: () => { preloads += 1; } },
    scheduler,
  );
  cancel();
  run();
  assert.equal(preloads, 0);
});

test("the workspace-open path schedules one guarded, idle preload of the editor runtimes", async () => {
  const [preload, surface, app] = await Promise.all([
    readFile(new URL("../src/features/files-editor/editor-runtime-preload.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/editor-surface.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app.ts", import.meta.url), "utf8"),
  ]);
  // Presentation code loading only: idle scheduling, a bounded fallback, and no repository read.
  assert.match(preload, /requestIdleCallback/u);
  assert.match(preload, /timeout: 3_000/u);
  assert.match(preload, /window\.setTimeout\(callback, 250\)/u);
  // The scheduler imports nothing, so a preload can never reach repository or bridge data.
  assert.doesNotMatch(preload, /^import\s/mu);
  assert.match(surface, /scheduleRuntimePreload\(\): void \{[\s\S]*?if \(this\.cancelRuntimePreload\) return;[\s\S]*?this\.textEditor\.preload\(\);[\s\S]*?this\.diffEditor\.preload\(\);[\s\S]*?this\.editableDiffEditor\.preload\(\);/u);
  assert.match(surface, /destroy\(\): void \{\n    this\.cancelRuntimePreload\?\.\(\);/u);
  assert.match(app, /if \(!workspaceRoot\) return;\n    this\.editorSurface\.scheduleRuntimePreload\(\);/u);
});
