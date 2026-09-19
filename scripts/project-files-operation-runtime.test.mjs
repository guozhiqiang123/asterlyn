import assert from "node:assert/strict";
import test from "node:test";

import { ProjectFilesOperationRuntime } from "../src/features/files-editor/project-files-operation-runtime.ts";

const target = {
  workspaceRoot: "/repo",
  workspaceGeneration: 1,
  workspacePath: "src",
  kind: "directory",
  file: null,
  status: "unchanged",
  readOnly: false,
};

test("Project Files operation runtime owns controller and clipboard subscriptions", () => {
  let changed = 0;
  let clipboardChanged = 0;
  let cancelled = 0;
  const runtime = new ProjectFilesOperationRuntime({
    root: { querySelector: () => null },
    gateway: {},
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
      currentIdentity: () => ({ root: "/repo", generation: 1 }),
      isTargetCurrent: () => true,
      repositoryLocation: () => ({ repositoryId: ".", path: "src" }),
      completed: () => {},
      status: () => {},
      error: () => {},
    },
    messages: () => ({}),
    trash: { busy: () => false, request: async () => {} },
    copy: () => ({}),
    changed: () => {
      changed += 1;
    },
    clipboardChanged: () => {
      clipboardChanged += 1;
    },
  });

  assert.equal(runtime.controller.beginCreate(target), true);
  assert.equal(changed, 1);
  runtime.controller.clipboard.capture("copy", "/repo", 1, ".", "src", {
    source: { workspacePath: "src", kind: "directory" },
    fingerprint: "stable",
    truncated: false,
    symlinkPaths: [],
    nestedRepositoryPaths: [],
    multipleLinkPaths: [],
  });
  assert.equal(clipboardChanged, 1);

  runtime.dispose();
  runtime.dispose();
  runtime.controller.reset();
  runtime.controller.clipboard.capture("copy", "/repo", 1, ".", "src", {
    source: { workspacePath: "src", kind: "directory" },
    fingerprint: "stable",
    truncated: false,
    symlinkPaths: [],
    nestedRepositoryPaths: [],
    multipleLinkPaths: [],
  });
  assert.equal(changed, 1);
  assert.equal(clipboardChanged, 1);
  assert.equal(cancelled, 1);
});
