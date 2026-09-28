import assert from "node:assert/strict";
import test from "node:test";

import {
  compareFileTreeNodes,
  sortFilesByName,
} from "../src/presentation/file-name-order.ts";

test("flat file lists sort by file name before using the full path as a tie breaker", () => {
  const files = [
    { path: "aardvark/zeta.ts" },
    { path: "zebra/alpha.ts" },
    { path: "beta/alpha.ts" },
  ];

  assert.deepEqual(sortFilesByName(files).map((file) => file.path), [
    "beta/alpha.ts",
    "zebra/alpha.ts",
    "aardvark/zeta.ts",
  ]);
  assert.deepEqual(files.map((file) => file.path), [
    "aardvark/zeta.ts",
    "zebra/alpha.ts",
    "beta/alpha.ts",
  ]);
});

test("tree siblings keep directories first and sort each kind by name", () => {
  const nodes = [
    { kind: "file", name: "zeta.ts", path: "src/zeta.ts" },
    { kind: "directory", name: "zeta", path: "src/zeta" },
    { kind: "file", name: "alpha.ts", path: "src/alpha.ts" },
    { kind: "directory", name: "alpha", path: "src/alpha" },
  ];

  assert.deepEqual([...nodes].sort(compareFileTreeNodes).map((node) => node.name), [
    "alpha",
    "zeta",
    "alpha.ts",
    "zeta.ts",
  ]);
});
