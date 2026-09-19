import assert from "node:assert/strict";
import test from "node:test";

import { ChangesContextSurfaceRuntime } from "../src/features/changes-commit/changes-context-runtime.ts";
import { ProjectFilesContextSurfaceRuntime } from "../src/features/files-editor/project-files-context-runtime.ts";

for (const [name, Runtime] of [
  ["Files", ProjectFilesContextSurfaceRuntime],
  ["Changes", ChangesContextSurfaceRuntime],
]) {
  test(`${name} context surface owns and releases its delegated binding`, () => {
    const installed = [];
    const removed = [];
    const root = {
      addEventListener(type, listener) {
        installed.push({ type, listener });
      },
      removeEventListener(type, listener) {
        removed.push({ type, listener });
      },
    };
    const runtime = new Runtime({
      root,
      host: {},
      clipboard: {},
      source: () => ({}),
      actions: {},
      copy: () => ({}),
    });

    assert.deepEqual(installed.map(({ type }) => type), ["contextmenu", "keydown"]);
    runtime.dispose();
    runtime.dispose();
    assert.equal(removed.length, installed.length);
    assert.ok(removed.every(({ type, listener }, index) => (
      type === installed[index].type && listener === installed[index].listener
    )));
  });
}
