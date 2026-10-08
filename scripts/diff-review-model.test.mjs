import assert from "node:assert/strict";
import test from "node:test";

import { ConflictResolutionModel } from "../src/conflict-resolution-model.ts";
import { splitUnifiedDiff } from "../src/diff-presentation.ts";
import {
  conflictActionGroupVisible,
  projectConflictDiff,
  projectStaticSplitDiff,
  projectTwoWayDiff,
} from "../src/shared/diff-review/diff-review-projection.ts";

test("static patches group presentation rows into stable read-only review blocks", () => {
  const patch = [
    "@@ -1,4 +1,5 @@",
    " context",
    "-old",
    "+new",
    "+inserted",
    " context",
  ].join("\n");
  const projection = projectStaticSplitDiff(splitUnifiedDiff(patch).rows);

  assert.equal(projection.blocks.length, 1);
  assert.equal(projection.blocks[0].id, "patch:1:2");
  assert.equal(projection.blocks[0].kind, "modified");
  assert.equal(projection.blocks[0].status, "readonly");
  assert.equal(projection.summary.total, 1);
  assert.equal(projection.capabilities.toggleLayout, true);
});

test("two-way projections use immutable before ranges for stable ids", () => {
  const beforeEdit = projectTwoWayDiff([
    { fromA: 4, toA: 8, fromB: 4, toB: 9 },
    { fromA: 12, toA: 12, fromB: 13, toB: 18 },
  ], true);
  const afterResultGrowth = projectTwoWayDiff([
    { fromA: 4, toA: 8, fromB: 4, toB: 20 },
    { fromA: 12, toA: 12, fromB: 24, toB: 29 },
  ], true);

  assert.deepEqual(
    beforeEdit.blocks.map((block) => block.id),
    afterResultGrowth.blocks.map((block) => block.id),
  );
  assert.ok(beforeEdit.blocks.every((block) => block.actions[0]?.id === "revert"));
});

test("conflict projection classifies one-sided, identical, divergent, and manual blocks", () => {
  const oneSided = projection("base", "ours", "base", "base");
  assert.equal(oneSided.blocks[0].kind, "modified");
  assert.equal(oneSided.summary.nonConflicting, 1);
  assert.equal(oneSided.summary.pendingConflicts, 0);

  const identical = projection("base", "same", "same", "base");
  assert.equal(identical.blocks[0].kind, "identical");
  assert.equal(identical.summary.identical, 1);

  const model = ConflictResolutionModel.create("base", "ours", "theirs", "base");
  assert.equal(projectConflictDiff(model.snapshots()).blocks[0].kind, "conflict");
  const resultRange = model.snapshots()[0].result;
  model.observeManualChanges(
    [{ from: resultRange.from, to: resultRange.to, insert: "manual" }],
    4,
    "manual",
  );
  const manual = projectConflictDiff(model.snapshots());
  assert.equal(manual.blocks[0].status, "manual");
  assert.equal(manual.summary.manual, 1);
  assert.equal(manual.summary.pending, 1);
  assert.equal(manual.summary.pendingConflicts, 1);
});

test("clean initial merge presents auto-applied changes as reviewed before the first conflict", () => {
  const base = "prefix=old\nanchor\nshared=base\n";
  const ours = "prefix=old\nanchor\nshared=ours\n";
  const theirs = "prefix=new\nanchor\nshared=theirs\n";
  const result = "prefix=new\nanchor\nshared=base\n";
  const review = projection(base, ours, theirs, result);

  assert.equal(review.blocks[0].kind, "modified");
  assert.equal(review.blocks[0].status, "accepted");
  assert.equal(review.blocks[1].kind, "conflict");
  assert.equal(review.blocks[1].status, "pending");
  assert.equal(review.summary.pendingConflicts, 1);
  assert.equal(review.summary.explicitlyReviewed, 0);
});

test("completed conflict sides stay hidden when merge chunks are rebuilt", () => {
  assert.equal(conflictActionGroupVisible("pending"), true);
  assert.equal(conflictActionGroupVisible("mixed"), true);
  assert.equal(conflictActionGroupVisible("accepted"), false);
  assert.equal(conflictActionGroupVisible("ignored"), false);
  assert.equal(conflictActionGroupVisible(null), false);
  assert.equal(conflictActionGroupVisible(undefined), false);
});

test("conflict decisions feed shared selected and reviewed states", () => {
  const model = ConflictResolutionModel.create("base", "ours", "theirs", "base");
  const block = model.snapshots()[0];
  model.applyDecision("ours", "accepted", block.ours, "base");
  model.applyDecision("theirs", "ignored", block.theirs, "ours");
  const projection = projectConflictDiff(model.snapshots());

  assert.equal(projection.blocks[0].status, "accepted");
  assert.equal(projection.summary.reviewed, 1);
  assert.equal(projection.summary.explicitlyReviewed, 1);
  assert.equal(projection.summary.pending, 0);
  assert.equal(projection.summary.pendingConflicts, 0);
  assert.equal(
    projection.blocks[0].actions.find((action) => action.id === "apply-ours")?.selected,
    true,
  );
  assert.equal(
    projection.blocks[0].actions.find((action) => action.id === "ignore-theirs")?.selected,
    true,
  );
});

function projection(base, ours, theirs, result) {
  return projectConflictDiff(ConflictResolutionModel.create(base, ours, theirs, result).snapshots());
}
