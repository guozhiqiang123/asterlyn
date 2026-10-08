import assert from "node:assert/strict";
import test from "node:test";

import { ConflictResolutionModel } from "../src/conflict-resolution-model.ts";
import {
  applyExactTextChanges,
  decodeExactText,
  encodeExactText,
} from "../src/features/files-editor/text-content.ts";

test("conflict actions compose Ours then Theirs in either click order", () => {
  const fixture = () => {
    const result = "start\nbase\nend\n";
    const model = ConflictResolutionModel.create(
      result,
      "start\nours\nend\n",
      "start\ntheirs\nend\n",
      result,
    );
    const block = model.snapshots()[0];
    return { model, result, ours: block.ours, theirs: block.theirs };
  };

  const oursFirst = fixture();
  let oursFirstResult = applyDecision(oursFirst, "ours", "accepted", oursFirst.ours);
  oursFirstResult = applyDecision(
    { ...oursFirst, result: oursFirstResult },
    "theirs",
    "accepted",
    oursFirst.theirs,
  );

  const theirsFirst = fixture();
  let theirsFirstResult = applyDecision(theirsFirst, "theirs", "accepted", theirsFirst.theirs);
  theirsFirstResult = applyDecision(
    { ...theirsFirst, result: theirsFirstResult },
    "ours",
    "accepted",
    theirsFirst.ours,
  );

  assert.equal(oursFirstResult, "start\nours\ntheirs\nend\n");
  assert.equal(theirsFirstResult, oursFirstResult);
});

test("matching Result text never substitutes for an explicit side decision", () => {
  const model = ConflictResolutionModel.create("base", "ours", "theirs", "ours");
  const block = model.snapshots()[0];

  assert.equal(block.oursDecision, "pending");
  assert.equal(block.theirsDecision, "pending");
});

test("accepting both sides keeps both decisions completed after Result composition", () => {
  const model = ConflictResolutionModel.create("base", "ours", "theirs", "base");
  const block = model.snapshots()[0];
  let result = applyModelDecision(model, "ours", "accepted", block.ours, "base");
  result = applyModelDecision(model, "theirs", "accepted", block.theirs, result);

  assert.equal(result, "ours\ntheirs");
  assert.equal(model.snapshots()[0].oursDecision, "accepted");
  assert.equal(model.snapshots()[0].theirsDecision, "accepted");
});

test("equal conflict sides are inserted only once", () => {
  const result = "before\nbase\nafter\n";
  const model = ConflictResolutionModel.create(
    result,
    "before\nsame\nafter\n",
    "before\nsame\nafter\n",
    result,
  );
  const block = model.snapshots()[0];
  let current = applyModelDecision(model, "ours", "accepted", block.ours, result);
  current = applyModelDecision(model, "theirs", "accepted", block.theirs, current);
  assert.equal(current, "before\nsame\nafter\n");
});

test("insertions at the same Base position compose without losing either side", () => {
  const base = "header\nfooter\n";
  const model = ConflictResolutionModel.create(
    base,
    "header\nours\nfooter\n",
    "header\ntheirs\nfooter\n",
    base,
  );
  const block = model.snapshots()[0];
  let current = applyModelDecision(model, "ours", "accepted", block.ours, base);
  current = applyModelDecision(model, "theirs", "accepted", block.theirs, current);
  assert.equal(current, "header\nours\ntheirs\nfooter\n");
});

test("two-sided actions preserve the Result document's CRLF policy", () => {
  const base = decodeExactText("start\r\nbase\r\nend\r\n");
  const ours = decodeExactText("start\r\nours\r\nend\r\n").text;
  const theirs = decodeExactText("start\r\ntheirs\r\nend\r\n").text;
  const model = ConflictResolutionModel.create(base.text, ours, theirs, base.text);
  const block = model.snapshots()[0];
  const oursChanges = model.applyDecision("ours", "accepted", block.ours, base.text);
  const afterOurs = applyExactTextChanges(base, oursChanges);
  const theirsChanges = model.applyDecision("theirs", "accepted", block.theirs, afterOurs.text);
  const combined = applyExactTextChanges(afterOurs, theirsChanges);

  assert.equal(encodeExactText(combined), "start\r\nours\r\ntheirs\r\nend\r\n");
});

test("delete versus modify remains deterministic when both sides are accepted", () => {
  const base = "start\nbase\nend\n";
  const model = ConflictResolutionModel.create(base, "start\nend\n", "start\ntheirs\nend\n", base);
  const block = model.snapshots()[0];
  let current = applyModelDecision(model, "ours", "accepted", block.ours, base);
  current = applyModelDecision(model, "theirs", "accepted", block.theirs, current);
  assert.equal(current, "start\ntheirs\nend\n");
});

test("ignoring an accepted side recomputes from the remaining decision", () => {
  const base = "base";
  const model = ConflictResolutionModel.create(base, "ours", "theirs", base);
  const block = model.snapshots()[0];
  let current = applyModelDecision(model, "ours", "accepted", block.ours, base);
  current = applyModelDecision(model, "theirs", "accepted", block.theirs, current);
  current = applyModelDecision(model, "ours", "ignored", block.ours, current);
  assert.equal(current, "theirs");
  current = applyModelDecision(model, "theirs", "ignored", block.theirs, current);
  assert.equal(current, base);
});

test("manual edits invalidate stale decisions and become the block fallback", () => {
  const base = "start\nbase\nend\n";
  const model = ConflictResolutionModel.create(
    base,
    "start\nours\nend\n",
    "start\ntheirs\nend\n",
    base,
  );
  const source = model.snapshots()[0].ours;
  let current = applyModelDecision(model, "ours", "accepted", source, base);
  const resultRange = model.snapshots()[0].result;
  const manual = [{ from: resultRange.from, to: resultRange.to, insert: "custom" }];
  const afterManual = applyChanges(current, manual);
  model.observeManualChanges(manual, current.length, afterManual);

  assert.equal(model.snapshots()[0].oursDecision, "pending");
  assert.deepEqual(model.applyDecision("ours", "ignored", source, afterManual), []);
  assert.equal(afterManual, "start\ncustom\nend\n");
});

test("independent blocks keep later Result ranges mapped after an earlier length change", () => {
  const base = "one\ntwo\nthree\n";
  const model = ConflictResolutionModel.create(
    base,
    "one expanded\ntwo\nthree\n",
    "one\ntwo\nthree from theirs\n",
    base,
  );
  const [first, second] = model.snapshots();
  let current = applyModelDecision(model, "ours", "accepted", first.ours, base);
  current = applyModelDecision(model, "theirs", "accepted", second.theirs, current);
  assert.equal(current, "one expanded\ntwo\nthree from theirs\n");
  assert.equal(model.hasChanges("ours", second.ours), false);
  assert.equal(model.hasChanges("theirs", first.theirs), false);
});

test("bulk All applies one-sided blocks and leaves divergent conflicts pending", () => {
  const base = "one\nkeep one\ntwo\nkeep two\nthree\n";
  const model = ConflictResolutionModel.create(
    base,
    "ours one\nkeep one\ntwo\nkeep two\nours three\n",
    "one\nkeep one\ntheirs two\nkeep two\ntheirs three\n",
    base,
  );

  const bulk = model.applyNonConflicting("all", base);
  const result = applyChanges(base, bulk.changes);
  const snapshots = model.snapshots();

  assert.equal(result, "ours one\nkeep one\ntheirs two\nkeep two\nthree\n");
  assert.equal(bulk.appliedBlocks, 2);
  assert.equal(bulk.skippedManualBlocks, 0);
  assert.equal(snapshots.filter((block) =>
    (block.oursChanged && block.oursDecision === "pending") ||
    (block.theirsChanged && block.theirsDecision === "pending"),
  ).length, 1);
});

test("directional bulk apply resolves identical sides once and skips manual blocks", () => {
  const identical = ConflictResolutionModel.create("base", "same", "same", "base");
  const applied = identical.applyNonConflicting("ours", "base");
  assert.equal(applyChanges("base", applied.changes), "same");
  assert.equal(identical.snapshots()[0].oursDecision, "accepted");
  assert.equal(identical.snapshots()[0].theirsDecision, "ignored");

  const manual = ConflictResolutionModel.create("base", "ours", "base", "base");
  manual.observeManualChanges([{ from: 0, to: 4, insert: "custom" }], 4, "custom");
  const skipped = manual.applyNonConflicting("ours", "custom");
  assert.deepEqual(skipped.changes, []);
  assert.equal(skipped.appliedBlocks, 0);
  assert.equal(skipped.skippedManualBlocks, 1);
  assert.equal(manual.snapshots()[0].manuallyEdited, true);
});

function applyDecision(fixture, side, decision, source) {
  return applyModelDecision(fixture.model, side, decision, source, fixture.result);
}

function applyModelDecision(model, side, decision, source, result) {
  return applyChanges(result, model.applyDecision(side, decision, source, result));
}

function applyChanges(content, changes) {
  let result = content;
  for (const change of [...changes].sort((left, right) => right.from - left.from)) {
    result = `${result.slice(0, change.from)}${change.insert}${result.slice(change.to)}`;
  }
  return result;
}
