import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKBENCH_LAYOUT_DEFAULTS,
  WORKBENCH_LAYOUT_KEY,
  clampWorkbenchLayout,
  loadWorkbenchLayout,
  reduceWorkbenchLayout,
  saveWorkbenchLayout,
} from "../src/workbench/layout-state.ts";
import {
  editorDocumentContentKey,
  editorDocumentKey,
} from "../src/workbench/editor-document.ts";
import { resizeValue } from "../src/workbench/splitter.ts";

test("left and bottom tools toggle independently", () => {
  const filesClosed = reduceWorkbenchLayout(WORKBENCH_LAYOUT_DEFAULTS, {
    type: "toggle-left-tool",
    tool: "files",
  });
  assert.equal(filesClosed.leftTool, null);
  assert.equal(filesClosed.bottomTool, "branches");

  const changesOpen = reduceWorkbenchLayout(filesClosed, {
    type: "toggle-left-tool",
    tool: "changes",
  });
  assert.equal(changesOpen.leftTool, "changes");
  assert.equal(changesOpen.bottomTool, "branches");

  const branchesClosed = reduceWorkbenchLayout(changesOpen, {
    type: "toggle-bottom-tool",
    tool: "branches",
  });
  assert.equal(branchesClosed.leftTool, "changes");
  assert.equal(branchesClosed.bottomTool, null);
});

test("malformed and unknown persisted layouts reset safely", () => {
  const malformed = memoryStorage("not json");
  assert.deepEqual(loadWorkbenchLayout(malformed), WORKBENCH_LAYOUT_DEFAULTS);

  const unknown = memoryStorage(JSON.stringify({ version: 9, leftTool: "files" }));
  assert.deepEqual(loadWorkbenchLayout(unknown), WORKBENCH_LAYOUT_DEFAULTS);
});

test("layout persistence excludes unrelated session state", () => {
  const storage = memoryStorage(null);
  const layout = { ...WORKBENCH_LAYOUT_DEFAULTS, leftTool: "changes", leftWidth: 364 };
  saveWorkbenchLayout(storage, layout);
  assert.deepEqual(loadWorkbenchLayout(storage), layout);
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(WORKBENCH_LAYOUT_KEY))).sort(), [
    "bottomHeight",
    "bottomTool",
    "branchDetailsWidth",
    "branchTreeWidth",
    "commitSummaryHeight",
    "diffBeforePercent",
    "leftTool",
    "leftWidth",
    "version",
  ]);
});

test("viewport clamping preserves usable editor and branch columns", () => {
  const clamped = clampWorkbenchLayout(
    {
      ...WORKBENCH_LAYOUT_DEFAULTS,
      leftWidth: 900,
      bottomHeight: 900,
      branchTreeWidth: 900,
      branchDetailsWidth: 900,
      commitSummaryHeight: 900,
      diffBeforePercent: 99,
    },
    { width: 1_100, height: 700 },
  );
  assert.equal(clamped.leftWidth, 715);
  assert.equal(clamped.bottomHeight, 485);
  assert.equal(clamped.branchTreeWidth, 540);
  assert.equal(clamped.branchDetailsWidth, 230);
  assert.equal(clamped.commitSummaryHeight, 370);
  assert.equal(clamped.diffBeforePercent, 75);
});

test("splitter values honor direction and range", () => {
  const range = { minimum: 200, maximum: 500 };
  assert.equal(resizeValue(300, 80, 1, range), 380);
  assert.equal(resizeValue(300, 80, -1, range), 220);
  assert.equal(resizeValue(300, 800, 1, range), 500);
  assert.equal(resizeValue(300, 800, -1, range), 200);
});

test("same working Diff identity remounts for each content revision", () => {
  const document = {
    kind: "working-diff",
    repositoryRoot: "/workspace/project",
    selection: { path: "src/app.ts", staged: false },
  };

  assert.equal(editorDocumentKey(document), editorDocumentKey({ ...document }));
  assert.notEqual(
    editorDocumentContentKey(document, "patch:4"),
    editorDocumentContentKey(document, "loading"),
  );
  assert.notEqual(
    editorDocumentContentKey(document, "patch:4"),
    editorDocumentContentKey(document, "patch:5"),
  );
});

function memoryStorage(initial) {
  const entries = new Map();
  if (initial !== null) entries.set(WORKBENCH_LAYOUT_KEY, initial);
  return {
    getItem(key) {
      return entries.get(key) ?? null;
    },
    setItem(key, value) {
      entries.set(key, value);
    },
  };
}
