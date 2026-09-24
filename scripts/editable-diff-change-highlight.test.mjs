import assert from "node:assert/strict";
import test from "node:test";

import { EditorState, Text } from "@codemirror/state";
import {
  activeEditableDiffBlockDecoration,
  diffBlockFromOffsets,
  setActiveEditableDiffBlock,
} from "../src/features/files-editor/editable-diff-change-highlight.ts";

function decoratedLines(state) {
  const result = [];
  state.field(activeEditableDiffBlockDecoration).between(0, state.doc.length, (from, _to, decoration) => {
    result.push({ line: state.doc.lineAt(from).number, className: decoration.spec.class });
  });
  return result;
}

test("editable Changes Diff decorates each line of the selected chunk like Push Diff", () => {
  let state = EditorState.create({ doc: "first\nsecond\nthird", extensions: [activeEditableDiffBlockDecoration] });
  state = state.update({ effects: setActiveEditableDiffBlock.of({ fromLine: 1, toLine: 3 }) }).state;
  assert.deepEqual(decoratedLines(state), [
    { line: 1, className: "cm-diff-current-change cm-diff-current-change-start" },
    { line: 2, className: "cm-diff-current-change" },
    { line: 3, className: "cm-diff-current-change cm-diff-current-change-end" },
  ]);

  state = state.update({ effects: setActiveEditableDiffBlock.of({ fromLine: 2, toLine: 2 }) }).state;
  assert.deepEqual(decoratedLines(state), [
    { line: 2, className: "cm-diff-current-change cm-diff-current-change-start cm-diff-current-change-end" },
  ]);
  state = state.update({ effects: setActiveEditableDiffBlock.of(null) }).state;
  assert.deepEqual(decoratedLines(state), []);
});

test("editable Diff maps chunk offsets to changed lines without including the next line", () => {
  const doc = Text.of(["first", "second", "third"]);
  assert.deepEqual(diffBlockFromOffsets(doc, 0, 12), { fromLine: 1, toLine: 2 });
  assert.deepEqual(diffBlockFromOffsets(doc, 6, 12), { fromLine: 2, toLine: 2 });
  assert.equal(diffBlockFromOffsets(doc, 12, 12), null);
});
