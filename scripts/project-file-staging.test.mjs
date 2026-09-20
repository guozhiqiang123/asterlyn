import assert from "node:assert/strict";
import test from "node:test";

import {
  createCreatedFileStagingRuntime,
  resolveProjectFilesRepositoryLocation,
} from "../src/features/files-editor/project-file-staging.ts";

function snapshot() {
  return {
    root: "/repo",
    repositoryRoots: [
      { id: ".", relativePath: ".", displayName: "repo", kind: "main" },
      { id: "vendor/lib", relativePath: "vendor/lib", displayName: "lib", kind: "submodule" },
    ],
  };
}

test("workspace paths resolve to the most specific Git root", () => {
  const repository = snapshot();
  assert.deepEqual(
    resolveProjectFilesRepositoryLocation("src/app.ts", "/repo", repository),
    { repositoryId: ".", path: "src/app.ts" },
  );
  assert.deepEqual(
    resolveProjectFilesRepositoryLocation("vendor/lib/src/lib.rs", "/repo", repository),
    { repositoryId: "vendor/lib", path: "src/lib.rs" },
  );
  assert.deepEqual(
    resolveProjectFilesRepositoryLocation("notes.txt", "/ordinary", null),
    { repositoryId: "workspace", path: "notes.txt" },
  );
  assert.equal(resolveProjectFilesRepositoryLocation("notes.txt", null, null), null);
});

test("created-file staging installs one exact-path mutation before rescanning", async () => {
  const records = { staged: [], installed: [], scans: [], completed: [] };
  const repository = snapshot();
  const runtime = createCreatedFileStagingRuntime({
    workspaceRoot: () => "/repo",
    snapshot: () => repository,
    beginTransition: () => 4,
    matches: (generation, root) => generation === 4 && root === "/repo",
    completeTransition: (generation) => records.completed.push(generation),
    stagePaths: async (root, paths) => {
      records.staged.push([root, paths]);
      return { tracked: { root, changes: [] }, invalidatedSlices: ["workingTree"] };
    },
    install: (outcome) => {
      records.installed.push(outcome);
      return outcome.tracked.root;
    },
    scanUntracked: (root, generation) => records.scans.push([root, generation]),
    failureMessage: () => "could not stage",
  });

  assert.equal(runtime.canStage("src/new.txt"), true);
  assert.equal(runtime.canStage("vendor/lib/new.txt"), false);
  await runtime.stage("src/new.txt");

  assert.deepEqual(records.staged, [["/repo", ["src/new.txt"]]]);
  assert.equal(records.installed.length, 1);
  assert.deepEqual(records.completed, [4]);
  assert.deepEqual(records.scans, [["/repo", 4]]);
});

test("a stale stage completion is never installed as current state", async () => {
  const records = { installed: 0, completed: 0 };
  const runtime = createCreatedFileStagingRuntime({
    workspaceRoot: () => "/repo",
    snapshot,
    beginTransition: () => 7,
    matches: () => false,
    completeTransition: () => { records.completed += 1; },
    stagePaths: async (root) => ({
      tracked: { root, changes: [] }, invalidatedSlices: ["workingTree"],
    }),
    install: () => { records.installed += 1; return "/repo"; },
    scanUntracked: () => {},
    failureMessage: () => "could not stage",
  });

  await assert.rejects(runtime.stage("src/new.txt"), /could not stage/);
  assert.equal(records.installed, 0);
  assert.equal(records.completed, 1);
});
