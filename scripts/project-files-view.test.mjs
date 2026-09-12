import assert from "node:assert/strict";
import test from "node:test";

import {
  PROJECT_TREE_MOUNT_LIMIT,
  projectTreeRenderWindow,
  projectTreeRows,
  renderProjectNavigation,
} from "../src/features/files-editor/project-files-view.ts";
import { buildProjectTree } from "../src/workbench/project-tree.ts";

test("expanded project trees are flattened in visible hierarchy order", () => {
  const tree = buildProjectTree(["src/a.ts", "src/deep/b.ts", "README.md"]);
  const rows = projectTreeRows(tree, new Set(["src", "src/deep"]));
  assert.deepEqual(rows.map(({ node, depth }) => [node.path, depth]), [
    ["src", 0], ["src/deep", 1], ["src/deep/b.ts", 2], ["src/a.ts", 1], ["README.md", 0],
  ]);
});

test("large project trees mount no more than the shared architecture budget", () => {
  const paths = Array.from({ length: 1_000 }, (_, index) => `file-${String(index).padStart(4, "0")}.ts`);
  const tree = buildProjectTree(paths);
  const window = projectTreeRenderWindow(paths.length, 27 * 700, 700);
  const html = renderProjectNavigation(state(), tree, 27 * 700, 700);
  const mounted = html.match(/data-project-node=/g)?.length ?? 0;

  assert.ok(window.start > 0);
  assert.ok(window.end < paths.length);
  assert.ok(mounted <= PROJECT_TREE_MOUNT_LIMIT);
  assert.match(html, /project-virtual-spacer/);
});

function state() {
  return {
    root: "/repo",
    paths: [],
    files: [],
    ignoredEntries: [],
    loading: false,
    error: null,
    truncated: false,
    selection: null,
    expandedDirectories: new Set(),
  };
}
