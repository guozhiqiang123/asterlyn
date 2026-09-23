import assert from "node:assert/strict";
import test from "node:test";

import {
  editorChangeHighlightLines,
  editorChangeIndicatorBlocks,
} from "../src/editor-change-indicators.ts";

test("change indicators classify additions, modifications, and deletions", () => {
  assert.deepEqual(
    editorChangeIndicatorBlocks("one\ntwo\n", "one\ninserted\ntwo\n").map(project),
    [{ kind: "added", lineFrom: 2, lineTo: 2 }],
  );
  assert.deepEqual(
    editorChangeIndicatorBlocks("one\ntwo\n", "one\nchanged\n").map(project),
    [{ kind: "modified", lineFrom: 2, lineTo: 2 }],
  );
  assert.deepEqual(
    editorChangeIndicatorBlocks("one\nremoved\ntwo\n", "one\ntwo\n").map(project),
    [{ kind: "deleted", lineFrom: 2, lineTo: 2 }],
  );
});

test("change indicator input normalizes CRLF baselines", () => {
  assert.deepEqual(editorChangeIndicatorBlocks("one\r\ntwo\r\n", "one\ntwo\n"), []);
});

test("before-side indicators anchor removals in the left document", () => {
  assert.deepEqual(
    editorChangeIndicatorBlocks("one\nremoved\ntwo\n", "one\ntwo\n", "a").map(project),
    [{ kind: "deleted", lineFrom: 2, lineTo: 2 }],
  );
  assert.deepEqual(
    editorChangeIndicatorBlocks("one\ntwo\n", "one\ninserted\ntwo\n", "a").map(project),
    [],
  );
});

test("revealed editor changes frame the complete line block", () => {
  assert.deepEqual(editorChangeHighlightLines({ lineFrom: 3, lineTo: 5 }, 8), [
    { lineNumber: 3, className: "cm-diff-current-change cm-diff-current-change-start" },
    { lineNumber: 4, className: "cm-diff-current-change" },
    { lineNumber: 5, className: "cm-diff-current-change cm-diff-current-change-end" },
  ]);
  assert.deepEqual(editorChangeHighlightLines({ lineFrom: 8, lineTo: 9 }, 8), [
    { lineNumber: 8, className: "cm-diff-current-change cm-diff-current-change-start cm-diff-current-change-end" },
  ]);
});

function project(block) {
  return { kind: block.kind, lineFrom: block.lineFrom, lineTo: block.lineTo };
}
