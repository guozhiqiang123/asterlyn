import assert from "node:assert/strict";
import test from "node:test";

import { evaluateSearchNavigation } from "../src/workbench/search-navigation.ts";

function tab(overrides = {}) {
  return {
    id: "project:/repo\0.\0src/app.ts",
    document: {
      kind: "project-file",
      repositoryRoot: "/repo",
      repositoryId: ".",
      path: "src/app.ts",
      workspacePath: "src/app.ts",
    },
    status: "ready",
    content: "alpha Browser omega",
    utf8Bom: false,
    revision: "revision-1",
    loadEpoch: 2,
    editVersion: 0,
    persistedVersion: 0,
    saveRequest: null,
    error: null,
    conflict: false,
    ...overrides,
  };
}

function match(overrides = {}) {
  return {
    repositoryId: ".",
    path: "src/app.ts",
    workspacePath: "src/app.ts",
    revision: "revision-1",
    fromUtf16: 6,
    toUtf16: 13,
    line: 1,
    columnUtf16: 7,
    preview: "alpha Browser omega",
    previewFromUtf16: 6,
    previewToUtf16: 13,
    leadingClipped: false,
    trailingClipped: false,
    ...overrides,
  };
}

test("search navigation accepts only a fresh clean matching document", () => {
  assert.equal(evaluateSearchNavigation("/repo", tab(), match()), "ready");
});

test("search navigation rejects another workspace or document identity", () => {
  assert.equal(evaluateSearchNavigation("/other", tab(), match()), "wrongWorkspace");
  assert.equal(
    evaluateSearchNavigation("/repo", tab(), match({ repositoryId: "module" })),
    "wrongDocument",
  );
  assert.equal(
    evaluateSearchNavigation("/repo", tab(), match({ workspacePath: "other/app.ts" })),
    "wrongDocument",
  );
});

test("search navigation never applies disk offsets to dirty, saving, or stale tabs", () => {
  assert.equal(
    evaluateSearchNavigation("/repo", tab({ editVersion: 1 }), match()),
    "dirty",
  );
  assert.equal(
    evaluateSearchNavigation(
      "/repo",
      tab({ saveRequest: { id: "save-1", capturedVersion: 0 } }),
      match(),
    ),
    "dirty",
  );
  assert.equal(
    evaluateSearchNavigation("/repo", tab(), match({ revision: "old" })),
    "staleRevision",
  );
});

test("search navigation validates UTF-16 bounds after the fresh read", () => {
  assert.equal(
    evaluateSearchNavigation("/repo", tab(), match({ toUtf16: 200 })),
    "invalidRange",
  );
  assert.equal(
    evaluateSearchNavigation("/repo", tab({ status: "loading" }), match()),
    "notReady",
  );
});
