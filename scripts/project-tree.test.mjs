import assert from "node:assert/strict";
import test from "node:test";

import {
  ancestorProjectDirectories,
  buildProjectTree,
  descendantProjectDirectories,
  findProjectTreeNode,
  projectTreeEntries,
  reconcileProjectTreeState,
} from "../src/workbench/project-tree.ts";

test("project tree groups paths and sorts directories before files", () => {
  const tree = buildProjectTree([
    "README.md",
    "src/zeta.ts",
    "src/app/main.ts",
    "src/alpha.ts",
    "README.md",
  ]);
  assert.deepEqual(
    tree.map((node) => [node.kind, node.name]),
    [
      ["directory", "src"],
      ["file", "README.md"],
    ],
  );
  assert.deepEqual(
    tree[0].children.map((node) => [node.kind, node.name]),
    [
      ["directory", "app"],
      ["file", "alpha.ts"],
      ["file", "zeta.ts"],
    ],
  );
  assert.equal(tree[0].children[0].children[0].path, "src/app/main.ts");
  assert.equal(tree[0].children[0].children[0].status, "unmodified");
});

test("project tree keeps explicit ignored directories and truthful file states", () => {
  const entries = projectTreeEntries(
    [
      { repositoryId: ".", path: "src/app.ts", workspacePath: "src/app.ts" },
      { repositoryId: ".", path: "src/new.ts", workspacePath: "src/new.ts" },
    ],
    [
      {
        path: "src/app.ts",
        originalPath: null,
        indexStatus: "unmodified",
        worktreeStatus: "modified",
        conflicted: false,
        submodule: false,
      },
      {
        path: "src/new.ts",
        originalPath: null,
        indexStatus: "added",
        worktreeStatus: "modified",
        conflicted: false,
        submodule: false,
      },
    ],
    [
      { workspacePath: ".cache", kind: "directory" },
      { workspacePath: "local.settings", kind: "file" },
    ],
  );
  const tree = buildProjectTree(entries);
  assert.equal(findProjectTreeNode(tree, ".cache")?.kind, "directory");
  assert.equal(findProjectTreeNode(tree, ".cache")?.status, "ignored");
  assert.equal(findProjectTreeNode(tree, "local.settings")?.status, "ignored");
  assert.equal(findProjectTreeNode(tree, "src/app.ts")?.status, "modified");
  assert.equal(findProjectTreeNode(tree, "src/new.ts")?.status, "added");
});

test("ignored file descendants materialize their parent directories", () => {
  const entries = projectTreeEntries(
    [{
      repositoryId: ".",
      path: "generated/cache/result.json",
      workspacePath: "generated/cache/result.json",
      readOnly: true,
    }],
    [],
    [{ workspacePath: "generated/cache/result.json", kind: "file" }],
  );
  const tree = buildProjectTree(entries);

  assert.equal(findProjectTreeNode(tree, "generated")?.kind, "directory");
  assert.equal(findProjectTreeNode(tree, "generated/cache")?.kind, "directory");
  assert.equal(findProjectTreeNode(tree, "generated/cache/result.json")?.status, "ignored");
});

test("project tree helpers reveal ancestors and enumerate a selected subtree", () => {
  const tree = buildProjectTree([
    "src/app/main.ts",
    "src/app/view.ts",
    "src/shared/value.ts",
    "README.md",
  ]);
  assert.deepEqual(ancestorProjectDirectories("src/app/main.ts"), ["src", "src/app"]);
  const source = findProjectTreeNode(tree, "src");
  assert.ok(source);
  assert.deepEqual(descendantProjectDirectories(source), ["src", "src/app", "src/shared"]);
});

test("project tree refresh retains valid disclosure and selection identities", () => {
  const tree = buildProjectTree([
    "docs/guide.md",
    "src/app/main.ts",
    "src/new/value.ts",
  ]);
  const reconciled = reconcileProjectTreeState(
    tree,
    new Set(["src", "src/app", "removed", "removed/nested"]),
    { path: "src/app/main.ts", kind: "file" },
  );
  assert.deepEqual([...reconciled.expandedDirectories], ["src", "src/app"]);
  assert.deepEqual(reconciled.selection, {
    path: "src/app/main.ts",
    kind: "file",
  });

  const removed = reconcileProjectTreeState(
    tree,
    reconciled.expandedDirectories,
    { path: "src/old.ts", kind: "file" },
  );
  assert.equal(removed.selection, null);
});
