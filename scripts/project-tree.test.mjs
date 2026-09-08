import assert from "node:assert/strict";
import test from "node:test";

import { buildProjectTree } from "../src/workbench/project-tree.ts";

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
});
