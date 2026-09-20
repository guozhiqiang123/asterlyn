import assert from "node:assert/strict";
import test from "node:test";

import { GitHistoryContextRuntime } from "../src/features/git-history/git-history-context-runtime.ts";

test("Git History context runtime owns one disposable delegated binding set", () => {
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
  const runtime = new GitHistoryContextRuntime({
    root,
    host: {},
    clipboard: {},
    copy: () => ({}),
    sources: {
      branch: () => ({}),
      history: () => ({}),
      detail: () => ({}),
      rangeSelection: () => null,
      markHistoryTarget: () => undefined,
    },
    ports: {
      branch: {},
      commit: {},
      range: {},
      folder: {},
      file: {},
    },
  });

  assert.deepEqual(installed.map(({ type }) => type), [
    "contextmenu", "keydown",
    "click",
    "contextmenu", "keydown",
    "contextmenu", "keydown",
  ]);

  runtime.dispose();
  runtime.dispose();
  assert.equal(removed.length, installed.length);
  assert.ok(removed.every(({ type, listener }, index) => (
    type === installed[index].type && listener === installed[index].listener
  )));
});
