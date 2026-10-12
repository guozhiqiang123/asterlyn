import assert from "node:assert/strict";
import test from "node:test";

import {
  editorChangeHighlightLines,
  editorChangeIndicatorBlocks,
} from "../src/editor-change-indicators.ts";
import { Text } from "@codemirror/state";
import {
  editorPatchRollbackChange,
  projectEditorPatch,
} from "../src/features/files-editor/editor-patch-popover.ts";

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

test("editor Patch projects only the selected modified block", () => {
  const baseline = text("one\nold value\nend\n");
  const current = text("one\nnew value\nend\n");
  const block = editorChangeIndicatorBlocks(
    baseline.toString(),
    current.toString(),
  )[0];
  assert.ok(block);

  assert.deepEqual(projectEditorPatch(baseline, current, block), {
    before: [{ lineNumber: 2, text: "old value" }],
    after: [{ lineNumber: 2, text: "new value" }],
  });
});

test("editor Patch keeps added, deleted, and HTML-like source literal", () => {
  const addedBaseline = text("one\nend\n");
  const addedCurrent = text("one\n<img onerror=alert(1)>\nend\n");
  const added = editorChangeIndicatorBlocks(
    addedBaseline.toString(),
    addedCurrent.toString(),
  )[0];
  assert.ok(added);
  assert.deepEqual(projectEditorPatch(addedBaseline, addedCurrent, added), {
    before: [],
    after: [{ lineNumber: 2, text: "<img onerror=alert(1)>" }],
  });

  const deletedBaseline = text("one\nremoved\nend\n");
  const deletedCurrent = text("one\nend\n");
  const deleted = editorChangeIndicatorBlocks(
    deletedBaseline.toString(),
    deletedCurrent.toString(),
  )[0];
  assert.ok(deleted);
  assert.deepEqual(projectEditorPatch(deletedBaseline, deletedCurrent, deleted), {
    before: [{ lineNumber: 2, text: "removed" }],
    after: [],
  });
});

test("editor Patch rollback restores only one block with exact newline semantics", () => {
  const baseline = text("one\nold\nmiddle\nkeep\n");
  const current = text("one\nnew\nmiddle\nchanged\n");
  const blocks = editorChangeIndicatorBlocks(baseline.toString(), current.toString());
  assert.equal(blocks.length, 2);

  const change = editorPatchRollbackChange(baseline, current, blocks[0]);
  assert.equal(apply(current.toString(), change), "one\nold\nmiddle\nchanged\n");

  const eofBaseline = text("one\nold");
  const eofCurrent = text("one\nnew");
  const eofBlock = editorChangeIndicatorBlocks(
    eofBaseline.toString(),
    eofCurrent.toString(),
  )[0];
  assert.ok(eofBlock);
  assert.equal(
    apply(
      eofCurrent.toString(),
      editorPatchRollbackChange(eofBaseline, eofCurrent, eofBlock),
    ),
    eofBaseline.toString(),
  );
});

function project(block) {
  return { kind: block.kind, lineFrom: block.lineFrom, lineTo: block.lineTo };
}

function text(value) {
  return Text.of(value.split("\n"));
}

function apply(content, change) {
  return content.slice(0, change.from) + change.insert + content.slice(change.to);
}
