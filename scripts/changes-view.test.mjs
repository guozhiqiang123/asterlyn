import assert from "node:assert/strict";
import test from "node:test";

import {
  CHANGE_TREE_MOUNT_LIMIT,
  changeDisclosureKeys,
  changeTreeRenderWindow,
  changeViewRows,
  renderChangeNavigation,
} from "../src/features/changes-commit/changes-view.ts";

test("change rows preserve groups and expanded directory hierarchy", () => {
  const current = snapshot([
    change("src/a.ts"),
    change("src/deep/b.ts"),
    change("new.txt", "untracked"),
  ]);
  const rows = changeViewRows(current, state());

  assert.deepEqual(rows.map((row) => row.kind === "file" ? row.change.path : row.kind === "directory" ? row.node.path : row.group), [
    "changes", "src", "src/deep", "src/deep/b.ts", "src/a.ts", "unversioned", "new.txt",
  ]);
  assert.deepEqual(changeDisclosureKeys(current), [
    "group:changes", "directory:changes:src", "directory:changes:src/deep", "group:unversioned",
  ]);
});

test("large change trees mount no more than the architecture budget", () => {
  const changes = Array.from({ length: 1_200 }, (_, index) =>
    change(`src/file-${String(index).padStart(4, "0")}.ts`),
  );
  const current = snapshot(changes);
  const viewState = state();
  const window = changeTreeRenderWindow(
    changeViewRows(current, viewState).length,
    28 * 800,
    700,
  );
  const html = renderChangeNavigation(current, viewState, 28 * 800, 700);
  const mounted = html.match(/aria-posinset=/g)?.length ?? 0;

  assert.ok(window.start > 0);
  assert.ok(window.end < changes.length);
  assert.ok(mounted <= CHANGE_TREE_MOUNT_LIMIT);
  assert.match(html, /change-virtual-spacer/);
});

function state() {
  return {
    selectedChange: null,
    excludedPaths: new Set(),
    fileView: "tree",
    collapsedDirectories: new Set(),
    commitMessage: "",
    workingPatch: null,
    workingImageDiff: null,
    workingPatchLoading: false,
    workingPatchError: null,
    workingPatchVersion: 0,
    mutation: null,
  };
}

function change(path, worktreeStatus = "modified") {
  return {
    path,
    originalPath: null,
    indexStatus: "unmodified",
    worktreeStatus,
    conflicted: false,
    submodule: false,
  };
}

function snapshot(changes) {
  return {
    root: "/repo",
    gitDir: "/repo/.git",
    repositoryRoots: [{ id: ".", path: "/repo", displayName: "repo" }],
    branch: {
      head: "main",
      oid: "a",
      upstream: null,
      upstreamRemote: null,
      upstreamRef: null,
      ahead: 0,
      behind: 0,
      detached: false,
      unborn: false,
    },
    operation: null,
    changes,
    commits: [],
    branches: [],
    remotes: [],
    untrackedState: "complete",
  };
}
