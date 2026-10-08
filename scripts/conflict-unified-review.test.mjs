import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { EditorState } from "@codemirror/state";
import { ConflictResolutionModel } from "../src/conflict-resolution-model.ts";
import {
  projectUnifiedConflictCards,
  setUnifiedConflictReview,
  unifiedConflictReviewExtension,
} from "../src/conflict-unified-review.ts";
import { EN_US } from "../src/localization/en-US.ts";
import { projectConflictDiff } from "../src/shared/diff-review/diff-review-projection.ts";

const base = "header\nbase value\nfooter\n";
const ours = "header\ncurrent value\nfooter\n";
const theirs = "header\nincoming value\nfooter\n";
const result = base;

test("three-way unified cards retain both immutable source ranges around one Result block", () => {
  const model = ConflictResolutionModel.create(base, ours, theirs, result);
  const snapshots = model.snapshots();
  const review = projectConflictDiff(snapshots);
  const cards = projectUnifiedConflictCards(snapshots, {
    ...review,
    activeBlockId: review.blocks[0].id,
  }, ours, theirs);

  assert.equal(cards.length, 1);
  assert.equal(cards[0].active, true);
  assert.equal(cards[0].status, "pending");
  assert.equal(cards[0].ours.text, "current value\n");
  assert.equal(cards[0].theirs.text, "incoming value\n");
  assert.deepEqual(cards[0].ours.range, snapshots[0].ours);
  assert.deepEqual(cards[0].theirs.range, snapshots[0].theirs);
  assert.equal(cards[0].ours.firstLine, 2);
  assert.equal(cards[0].theirs.lastLine, 2);
});

test("unified source widgets are presentation-only and never enter Result bytes", () => {
  const model = ConflictResolutionModel.create(base, ours, theirs, result);
  const snapshots = model.snapshots();
  const review = projectConflictDiff(snapshots);
  const cards = projectUnifiedConflictCards(snapshots, review, ours, theirs);
  const state = EditorState.create({ doc: result, extensions: [unifiedConflictReviewExtension] });
  const shown = state.update({ effects: setUnifiedConflictReview.of({
    cards,
    copy: EN_US.gitOperations,
    readOnly: false,
    decide() {},
  }) }).state;
  const hidden = shown.update({ effects: setUnifiedConflictReview.of(null) }).state;

  assert.equal(shown.doc.toString(), result);
  assert.equal(hidden.doc.toString(), result);
  assert.equal(shown.doc, state.doc, "layout decoration must not replace the Result document");
});

test("unified cards project the same explicit per-side decisions as split gutters", () => {
  const model = ConflictResolutionModel.create(base, ours, theirs, result);
  const source = model.snapshots()[0].ours;
  model.applyDecision("ours", "accepted", source, result);
  const snapshots = model.snapshots();
  const cards = projectUnifiedConflictCards(snapshots, projectConflictDiff(snapshots), ours, theirs);

  assert.equal(cards[0].ours.decision, "accepted");
  assert.equal(cards[0].theirs.decision, "pending");
  assert.equal(cards[0].status, "pending");
});

test("layout switching reconfigures the mounted Result instead of recreating it", async () => {
  const [editor, surface] = await Promise.all([
    readFile(new URL("../src/conflict-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/editor-surface.ts", import.meta.url), "utf8"),
  ]);
  const presentation = editor.slice(editor.indexOf("setPresentation("), editor.indexOf("setTheme("));

  assert.match(presentation, /syncUnifiedReview/u);
  assert.doesNotMatch(presentation, /destroy\(|new MergeView|\.mount\(/u);
  assert.match(editor, /resultSide === "primary" \? unifiedConflictReviewExtension : \[\]/u);
  assert.match(surface, /this\.conflictEditor\.setPresentation\(presentation\)/u);
});
