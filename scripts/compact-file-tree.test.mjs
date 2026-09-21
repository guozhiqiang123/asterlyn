import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPACT_FILE_TREE_ROW_HEIGHT,
  compactDirectoryChain,
  countCompactTreeFiles,
} from "../src/presentation/compact-file-tree.ts";

const file = (name, path) => ({ kind: "file", name, path, children: [] });
const directory = (name, path, children) => ({ kind: "directory", name, path, children });

test("compact file trees collapse only unary directory chains", () => {
  const rebuild = directory("docs", "docs", [
    directory("refactor", "docs/refactor", [
      directory("rebuild", "docs/refactor/rebuild", [
        file("README.md", "docs/refactor/rebuild/README.md"),
        file("notes.md", "docs/refactor/rebuild/notes.md"),
      ]),
    ]),
  ]);
  const chain = compactDirectoryChain(rebuild);
  assert.equal(chain.label, "docs/refactor/rebuild");
  assert.deepEqual(chain.paths, ["docs", "docs/refactor", "docs/refactor/rebuild"]);
  assert.equal(chain.terminal.path, "docs/refactor/rebuild");
  assert.equal(chain.fileCount, 2);
  assert.equal(countCompactTreeFiles(rebuild), 2);
  assert.equal(COMPACT_FILE_TREE_ROW_HEIGHT, 25);
});

test("compact file trees stop at a directory with file or directory siblings", () => {
  const src = directory("src", "src", [
    directory("features", "src/features", [file("index.ts", "src/features/index.ts")]),
    file("app.ts", "src/app.ts"),
  ]);
  const chain = compactDirectoryChain(src);
  assert.equal(chain.label, "src");
  assert.equal(chain.terminal, src);
  assert.equal(chain.fileCount, 2);
});
