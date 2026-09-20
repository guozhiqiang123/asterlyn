import assert from "node:assert/strict";
import test from "node:test";

import {
  projectFilesContextPolicy,
  projectFilesHistoryIntent,
} from "../src/features/files-editor/project-files-context-policy.ts";

const reasons = {
  readOnly: "read-only", mutationBusy: "busy", clipboardEmpty: "empty",
  operationsUnavailable: "unavailable", gitUnavailable: "no git", noHistory: "no history",
  ambiguousHistory: "ambiguous",
};

function snapshot() {
  return {
    root: "/workspace", gitDir: "/workspace/.git",
    repositoryRoots: [
      { id: ".", relativePath: ".", displayName: "workspace", kind: "main" },
      { id: "vendor/tool", relativePath: "vendor/tool", displayName: "tool", kind: "submodule" },
    ],
    branch: {}, operation: null, changes: [], commits: [], branches: [], remotes: [],
    untrackedState: "complete",
  };
}

const files = [
  { repositoryId: ".", path: "src/app.ts", workspacePath: "src/app.ts", readOnly: false },
  { repositoryId: ".", path: "src/lib.ts", workspacePath: "src/lib.ts", readOnly: false },
  { repositoryId: "vendor/tool", path: "main.rs", workspacePath: "vendor/tool/main.rs", readOnly: false },
];

function target(overrides = {}) {
  return {
    workspaceRoot: "/workspace", workspaceGeneration: 3, workspacePath: "src/app.ts",
    kind: "file", file: files[0], status: "unmodified", readOnly: false, ...overrides,
  };
}

test("Files history resolves exact file and directory Git identities", () => {
  assert.deepEqual(projectFilesHistoryIntent(target(), snapshot(), files)?.query, {
    repositoryIds: ["."], refs: [], startCommit: null,
    authorEmails: [], currentAuthor: false, sinceEpoch: null,
    paths: [{ repositoryId: ".", path: "src/app.ts" }], firstParent: false,
    excludeMerges: false, order: "topological",
  });
  assert.deepEqual(projectFilesHistoryIntent(target({
    workspacePath: "src", kind: "directory", file: null,
  }), snapshot(), files)?.query.paths, [{ repositoryId: ".", path: "src" }]);
  assert.deepEqual(projectFilesHistoryIntent(target({
    workspacePath: "vendor/tool", kind: "directory", file: null,
  }), snapshot(), files)?.query.paths, [{ repositoryId: "vendor/tool", path: "." }]);
});

test("untracked, ignored, non-Git and multi-root folders explain unavailable history", () => {
  const untracked = target({ status: "untracked" });
  assert.equal(projectFilesHistoryIntent(untracked, snapshot(), files), null);
  assert.equal(projectFilesContextPolicy(untracked, {
    snapshot: snapshot(), files, mutationBusy: false, mutationAvailable: true,
    clipboardAvailable: false, reasons,
  }).history.reason, "no history");
  assert.equal(projectFilesContextPolicy(target(), {
    snapshot: null, files, mutationBusy: false, mutationAvailable: true,
    clipboardAvailable: false, reasons,
  }).history.reason, "no git");
  const multiRoot = target({ workspacePath: "vendor", kind: "directory", file: null });
  const spanningFiles = [...files, { repositoryId: ".", path: "vendor/readme", workspacePath: "vendor/readme" }];
  assert.equal(projectFilesContextPolicy(multiRoot, {
    snapshot: snapshot(), files: spanningFiles, mutationBusy: false, mutationAvailable: true,
    clipboardAvailable: false, reasons,
  }).history.reason, "ambiguous");
});

test("mutation and paste policy distinguish read-only, busy and empty clipboard states", () => {
  assert.deepEqual(projectFilesContextPolicy(target({ readOnly: true }), {
    snapshot: snapshot(), files, mutationBusy: false, mutationAvailable: true,
    clipboardAvailable: true, reasons,
  }).mutation, { kind: "blocked", reason: "read-only" });
  assert.deepEqual(projectFilesContextPolicy(target(), {
    snapshot: snapshot(), files, mutationBusy: true, mutationAvailable: true,
    clipboardAvailable: true, reasons,
  }).mutation, { kind: "blocked", reason: "busy" });
  assert.deepEqual(projectFilesContextPolicy(target(), {
    snapshot: snapshot(), files, mutationBusy: false, mutationAvailable: true,
    clipboardAvailable: false, reasons,
  }).paste, { kind: "blocked", reason: "empty" });
});
