import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceTrashRuntime } from "../src/features/workspace-trash/workspace-trash-runtime.ts";

test("Workspace Trash runtime owns controller subscription and disposal", () => {
  let changed = 0;
  let cancelled = 0;
  const runtime = new WorkspaceTrashRuntime({
    root: { querySelector: () => null },
    mutations: {
      plan: () => {
        throw new Error("not used");
      },
      execute: () => {
        throw new Error("not used");
      },
      cancel: () => {
        cancelled += 1;
      },
    },
    runtime: {
      currentIdentity: () => null,
      isTargetCurrent: () => false,
      completed: () => {},
      status: () => {},
      error: () => {},
    },
    messages: () => ({
      targetChanged: "changed",
      blocked: "blocked",
      operationFailed: "failed",
      trashed: "trashed",
    }),
    copy: () => ({
      eyebrow: "Trash",
      title: "Trash entry?",
      cancel: "Cancel",
      confirm: "Trash",
      working: "Working",
      fileDetail: () => "file",
      folderDetail: () => "folder",
    }),
    focusTarget: () => null,
    changed: () => {
      changed += 1;
    },
  });

  runtime.controller.reset();
  assert.equal(changed, 1);
  runtime.dispose();
  runtime.dispose();
  runtime.controller.reset();
  assert.equal(changed, 1);
  assert.equal(cancelled, 2);
});
