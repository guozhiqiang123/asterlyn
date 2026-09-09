import assert from "node:assert/strict";
import test from "node:test";

import {
  historyPathCandidates,
  historyPathWorkspaceLabel,
  resolveHistoryPathText,
} from "../src/workbench/history-path-selection.ts";

const files = [
  { repositoryId: ".", path: "src/app.ts", workspacePath: "src/app.ts" },
  { repositoryId: ".", path: "README.md", workspacePath: "README.md" },
  {
    repositoryId: "modules/library",
    path: "src/app.ts",
    workspacePath: "modules/library/src/app.ts",
  },
];

test("path candidates include exact directories and preserve owning Git roots", () => {
  const candidates = historyPathCandidates(files);
  assert.ok(
    candidates.some(
      (path) => path.repositoryId === "." && path.path === "src" && path.directory,
    ),
  );
  assert.ok(
    candidates.some(
      (path) =>
        path.repositoryId === "modules/library" &&
        path.path === "src" &&
        path.workspacePath === "modules/library/src",
    ),
  );
});

test("multiline path selection resolves workspace paths without crossing roots", () => {
  const candidates = historyPathCandidates(files);
  assert.deepEqual(
    resolveHistoryPathText("src\nmodules/library/src/app.ts", candidates),
    {
      paths: [
        { repositoryId: ".", path: "src" },
        { repositoryId: "modules/library", path: "src/app.ts" },
      ],
      error: null,
    },
  );
  assert.match(
    resolveHistoryPathText("missing", candidates).error ?? "",
    /Unknown tracked path/,
  );
});

test("path labels reconstruct root-relative directory choices", () => {
  assert.equal(
    historyPathWorkspaceLabel(
      { repositoryId: "modules/library", path: "src" },
      files,
    ),
    "modules/library/src",
  );
});
