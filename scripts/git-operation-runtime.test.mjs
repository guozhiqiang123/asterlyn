import assert from "node:assert/strict";
import test from "node:test";

import { GitOperationRuntime } from "../src/features/git-operations/git-operation-runtime.ts";
import { EN_US } from "../src/localization/en-US.ts";

test("Git operation runtime owns controller notification and disposal", () => {
  const changes = [];
  const runtime = new GitOperationRuntime({
    root: { querySelector: () => null },
    gateway: {},
    initialCopy: EN_US.gitOperations,
    copy: () => EN_US.gitOperations,
    actions: {
      prepare: () => {},
      execute: () => {},
      resolve: () => {},
      reportError: () => {},
    },
    changed: (change) => changes.push(change.reason),
  });

  runtime.controller.installSnapshot(null);
  assert.deepEqual(changes, ["snapshot"]);
  runtime.dispose();
  runtime.dispose();
  runtime.controller.installSnapshot(null);
  assert.deepEqual(changes, ["snapshot"]);
});

test("Git operation runtime rejects late recovery-dialog activation after disposal", async () => {
  const runtime = new GitOperationRuntime({
    root: { querySelector: () => null },
    gateway: {},
    initialCopy: EN_US.gitOperations,
    copy: () => EN_US.gitOperations,
    actions: {
      prepare: () => {},
      execute: () => {},
      resolve: () => {},
      reportError: () => {},
    },
    changed: () => {},
    recovery: {
      actions: {
        activeRoot: () => "/repo",
        list: async () => [],
        undo: async () => {},
      },
      copy: () => ({}),
    },
  });

  const opening = runtime.openRecoveries("/repo");
  runtime.dispose();
  await opening;
  assert.equal(runtime.controller.state.dialog, null);
});
