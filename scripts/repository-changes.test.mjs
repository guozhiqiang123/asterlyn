import assert from "node:assert/strict";
import test from "node:test";

import { mergeTrackedChanges } from "../src/workbench/repository-changes.ts";

function change(path, worktreeStatus) {
  return {
    path,
    originalPath: null,
    indexStatus: "unmodified",
    worktreeStatus,
    conflicted: false,
    submodule: false,
  };
}

function snapshot() {
  return {
    root: "/repo",
    gitDir: "/repo/.git",
    repositoryRoots: [],
    branch: {},
    operation: null,
    changes: [change("old.ts", "modified"), change("notes.txt", "untracked")],
    commits: [{ oid: "commit-kept" }],
    branches: [{ fullName: "refs/heads/main" }],
    remotes: [],
    untrackedState: "complete",
  };
}

test("a tracked refresh replaces stale tracked status without discarding untracked files", () => {
  const original = snapshot();
  const merged = mergeTrackedChanges(original, {
    root: "/repo",
    changes: [change("new.ts", "modified")],
  });

  assert.deepEqual(
    merged.changes.map(({ path, worktreeStatus }) => [path, worktreeStatus]),
    [
      ["new.ts", "modified"],
      ["notes.txt", "untracked"],
    ],
  );
  assert.equal(merged.commits, original.commits);
  assert.equal(merged.branches, original.branches);
  assert.equal(merged.untrackedState, "complete");
});

test("a refresh from an obsolete repository cannot replace current status", () => {
  const original = snapshot();
  assert.equal(
    mergeTrackedChanges(original, {
      root: "/other",
      changes: [change("wrong.ts", "modified")],
    }),
    original,
  );
});

test("a path that became tracked is not duplicated by a preserved untracked row", () => {
  const original = snapshot();
  const merged = mergeTrackedChanges(original, {
    root: "/repo",
    changes: [
      {
        ...change("notes.txt", "unmodified"),
        indexStatus: "added",
      },
    ],
  });

  assert.equal(merged.changes.length, 1);
  assert.equal(merged.changes[0].path, "notes.txt");
  assert.equal(merged.changes[0].indexStatus, "added");
});
