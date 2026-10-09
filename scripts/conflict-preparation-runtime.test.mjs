import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Change, presentableDiff } from "@codemirror/merge";

import { prepareConflictEditor } from "../src/conflict-editor-preparation.ts";
import { ConflictPreparationRuntime } from "../src/features/files-editor/conflict-preparation-runtime.ts";

test("large conflict preparation stays bounded and preserves both visual Diffs", () => {
  const baseLines = Array.from({ length: 900 }, (_, index) => `dependency-${index}:1.0=classpath`);
  const oursLines = [...baseLines];
  const theirsLines = [...baseLines];
  const resultLines = [...baseLines];
  for (let index = 5; index < baseLines.length; index += 17) {
    oursLines[index] = `dependency-${index}:2.0=classpath`;
    resultLines[index] = oursLines[index];
  }
  for (let index = 11; index < baseLines.length; index += 19) {
    theirsLines[index] = `dependency-${index}:3.0=classpath`;
  }
  const input = {
    base: `${baseLines.join("\n")}\n`,
    ours: `${oursLines.join("\n")}\n`,
    result: `${resultLines.join("\n")}\n`,
    theirs: `${theirsLines.join("\n")}\n`,
  };

  const started = performance.now();
  const prepared = prepareConflictEditor(input);
  const elapsed = performance.now() - started;

  assert.equal(applyChanges(input.ours, input.result, prepared.oursToResult), input.result);
  assert.equal(applyChanges(input.theirs, input.result, prepared.theirsToResult), input.result);
  assert.ok(prepared.analysis.ours.length > 0);
  assert.ok(prepared.analysis.theirs.length > 0);
  assert.ok(elapsed < 250, `conflict preparation took ${elapsed.toFixed(1)}ms`);
});

test("conflict preparation runtime posts work before resolving it", async () => {
  const originalWorker = globalThis.Worker;
  let posted = false;
  let terminated = false;
  class FakeWorker {
    listeners = new Map();
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    postMessage({ id }) {
      posted = true;
      queueMicrotask(() => this.listeners.get("message")?.({
        data: {
          id,
          result: { analysis: { ours: [], result: [], theirs: [] }, oursToResult: [], theirsToResult: [] },
        },
      }));
    }
    terminate() { terminated = true; }
  }
  globalThis.Worker = FakeWorker;
  try {
    const runtime = new ConflictPreparationRuntime();
    const request = runtime.prepare({ base: "", ours: "", result: "", theirs: "" });
    assert.equal(posted, true);
    const prepared = await request;
    assert.deepEqual(prepared.oursToResult, []);
    runtime.dispose();
    assert.equal(terminated, true);
  } finally {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
});

test("worker preparation restores CodeMirror Change values after structured clone", async () => {
  const originalWorker = globalThis.Worker;
  const insertedLine = { fromA: 4, toA: 4, fromB: 4, toB: 8 };
  class FakeWorker {
    listeners = new Map();
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    postMessage({ id }) {
      queueMicrotask(() => this.listeners.get("message")?.({
        data: {
          id,
          result: {
            analysis: { ours: [insertedLine], result: [], theirs: [] },
            oursToResult: [insertedLine],
            theirsToResult: [],
          },
        },
      }));
    }
    terminate() {}
  }
  globalThis.Worker = FakeWorker;
  try {
    const runtime = new ConflictPreparationRuntime();
    const prepared = await runtime.prepare({ base: "", ours: "", result: "", theirs: "" });
    assert.ok(prepared.analysis.ours[0] instanceof Change);
    assert.ok(prepared.oursToResult[0] instanceof Change);
    assert.doesNotThrow(() => presentableDiff("foo\nbar\n", "foo\nbar\nbar\n", {
      override: () => prepared.oursToResult,
    }));
    runtime.dispose();
  } finally {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
});

test("conflict mount failures render a visible error instead of an empty surface", async () => {
  const runtime = await readFile(
    new URL("../src/features/files-editor/lazy-merge-editor-runtime.ts", import.meta.url),
    "utf8",
  );
  assert.match(runtime, /\.catch\(\(error: unknown\) => \{/u);
  assert.match(runtime, /pending\.parent\.innerHTML = emptyState\(/u);
  assert.match(runtime, /pending\.copy\.conflictUnavailable/u);
});

test("Changes context menu remains snapshot-only while conflict preparation is active", async () => {
  const [actions, binding, runtime] = await Promise.all([
    readFile(new URL("../src/features/changes-commit/changes-context-actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/context-menu/delegated-context-binding.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/conflict-preparation-runtime.ts", import.meta.url), "utf8"),
  ]);
  assert.match(actions, /open\(request: DelegatedContextRequest<ChangesContextTarget>\): boolean/u);
  const openFrom = actions.indexOf("  open(request:");
  const availabilityFrom = actions.indexOf("  commandAvailability(", openFrom);
  assert.ok(openFrom >= 0 && availabilityFrom > openFrom);
  const openBody = actions.slice(openFrom, availabilityFrom);
  assert.doesNotMatch(openBody, /readConflictContent/u);
  assert.ok(openBody.indexOf("this.host.open") < openBody.indexOf("invoke: async"));
  assert.match(binding, /const handled = this\.options\.open/u);
  assert.match(runtime, /new Worker\(/u);
  assert.match(runtime, /worker\.postMessage\(\{ id, input \}\)/u);
});

function applyChanges(before, after, changes) {
  let result = "";
  let cursor = 0;
  for (const change of changes) {
    result += before.slice(cursor, change.fromA);
    result += after.slice(change.fromB, change.toB);
    cursor = change.toA;
  }
  return result + before.slice(cursor);
}
