import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WORKBENCH_LAYOUT_DEFAULTS,
  clampWorkbenchLayout,
} from "../src/shell/layout-state.ts";

test("review layouts retain distinct read-only, editable, and conflict defaults", () => {
  assert.equal(WORKBENCH_LAYOUT_DEFAULTS.diffBeforePercent, 50);
  assert.equal(WORKBENCH_LAYOUT_DEFAULTS.editableDiffBeforePercent, 42);
  assert.equal(WORKBENCH_LAYOUT_DEFAULTS.conflictOursPercent, 27);
  assert.equal(WORKBENCH_LAYOUT_DEFAULTS.conflictResultPercent, 46);
});

test("conflict layout always leaves every pane a readable minimum", () => {
  const clamped = clampWorkbenchLayout({
    ...WORKBENCH_LAYOUT_DEFAULTS,
    conflictOursPercent: 70,
    conflictResultPercent: 70,
  }, { width: 1_400, height: 900 });
  const theirs = 100 - clamped.conflictOursPercent - clamped.conflictResultPercent;

  assert.ok(clamped.conflictOursPercent >= 18);
  assert.ok(clamped.conflictResultPercent >= 18);
  assert.ok(theirs >= 18);
});

test("two-pane and three-pane editors use the shared header and splitter contracts", async () => {
  const [editable, editableSplitter, conflict, labels] = await Promise.all([
    readFile(new URL("../src/editable-diff-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/diff-review/editable-diff-review-splitter.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/conflict-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/diff-side-labels.ts", import.meta.url), "utf8"),
  ]);

  assert.match(labels, /createDiffReviewPaneHeaders/u);
  assert.match(editable, /editableSplitPercentage \?\? 42/u);
  assert.match(editableSplitter, /attachSplitter\(splitter/u);
  assert.match(conflict, /createDiffReviewPaneHeaders/u);
  assert.equal((conflict.match(/attachSplitter\(/g) ?? []).length, 2);
  assert.match(conflict, /normalizeConflictPercentages/u);
});
