import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChangeFileTree,
  changeGroup,
  descendantChangePaths,
  effectiveChangeKind,
  includedChanges,
  reconcileExcludedChangePaths,
} from "../src/workbench/change-presentation.ts";

function change(path, indexStatus = "unmodified", worktreeStatus = "modified") {
  return {
    path,
    originalPath: null,
    indexStatus,
    worktreeStatus,
    conflicted: false,
    submodule: false,
  };
}

test("change groups and effective colors describe each path once", () => {
  const stagedAndModified = change("src/app.ts", "modified", "modified");
  const stagedOnly = change("README.md", "added", "unmodified");
  const untracked = change("notes.txt", "unmodified", "untracked");
  assert.equal(changeGroup(stagedAndModified), "changes");
  assert.equal(changeGroup(untracked), "unversioned");
  assert.equal(effectiveChangeKind(stagedAndModified), "modified");
  assert.equal(effectiveChangeKind(stagedOnly), "added");
});

test("excluded paths survive refresh only while the change still exists", () => {
  const changes = [change("a.txt"), change("b.txt")];
  assert.deepEqual(
    includedChanges(changes, new Set(["b.txt"])).map((item) => item.path),
    ["a.txt"],
  );
  assert.deepEqual(
    reconcileExcludedChangePaths(new Set(["b.txt", "gone.txt"]), changes),
    new Set(["b.txt"]),
  );
});

test("tree projection keeps directory ancestry and exact descendant paths", () => {
  const tree = buildChangeFileTree([
    change("src/core/a.ts"),
    change("src/ui/b.ts"),
    change("README.md"),
  ]);
  assert.deepEqual(tree.map((node) => node.name), ["src", "README.md"]);
  assert.deepEqual(descendantChangePaths(tree[0]), ["src/core/a.ts", "src/ui/b.ts"]);
});
