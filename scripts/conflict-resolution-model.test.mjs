import assert from "node:assert/strict";
import test from "node:test";
import { history, redo, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";

import {
  conflictResolutionHistoryExtension,
  conflictResolutionHistoryState,
  conflictResolutionTransaction,
} from "../src/conflict-resolution-history.ts";
import { ConflictResolutionModel } from "../src/conflict-resolution-model.ts";
import {
  applyExactTextChanges,
  decodeExactText,
  encodeExactText,
} from "../src/features/files-editor/text-content.ts";
import { projectConflictDiff } from "../src/shared/diff-review/diff-review-projection.ts";

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

test("Undo restores the previous side decisions before ignoring the reverted side", () => {
  const model = ConflictResolutionModel.create("base", "ours", "theirs", "base");
  const block = model.snapshots()[0];
  let state = EditorState.create({
    doc: "base",
    extensions: [history(), conflictResolutionHistoryExtension],
  });
  const dispatchDecision = (side, decision, source) => {
    const before = model.historyState();
    const changes = model.applyDecision(side, decision, source, state.doc.toString());
    const transaction = state.update(conflictResolutionTransaction(
      before, model.historyState(), changes, `input.conflict.${decision}`,
    ));
    state = transaction.state;
    assert.equal(model.restoreHistoryState(conflictResolutionHistoryState([transaction])), true);
    return changes;
  };
  const dispatchHistory = (command) => {
    let applied = null;
    assert.equal(command({ state, dispatch: (transaction) => { applied = transaction; state = transaction.state; } }), true);
    const restored = conflictResolutionHistoryState([applied]);
    assert.ok(restored);
    const changes = transactionChanges(applied);
    assert.equal(model.observeHistoryChanges(changes, applied.startState.doc.length, restored), true);
  };

  dispatchDecision("ours", "accepted", block.ours);
  dispatchDecision("theirs", "accepted", block.theirs);
  assert.equal(state.doc.toString(), "ours\ntheirs");

  dispatchHistory(undo);
  assert.equal(state.doc.toString(), "ours");
  assert.equal(model.snapshots()[0].oursDecision, "accepted");
  assert.equal(model.snapshots()[0].theirsDecision, "pending");

  assert.deepEqual(dispatchDecision("theirs", "ignored", block.theirs), []);
  assert.equal(projectConflictDiff(model.snapshots()).summary.pendingConflicts, 0);

  dispatchHistory(undo);
  assert.equal(model.snapshots()[0].theirsDecision, "pending");
  dispatchHistory(redo);
  assert.equal(projectConflictDiff(model.snapshots()).summary.pendingConflicts, 0);
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

test("worktree markers split a repeated add/add insertion into exact two-sided conflicts", () => {
  const fixture = repeatedAddAddFixture();
  const model = ConflictResolutionModel.create(
    fixture.base,
    fixture.ours,
    fixture.theirs,
    fixture.result,
    fixture.worktree,
  );
  const review = projectConflictDiff(model.snapshots());
  const conflicts = review.blocks.filter((block) => block.kind === "conflict");

  assert.equal(conflicts.length, 2);
  assert.equal(review.summary.authoritativeConflicts, 2);
  assert.equal(review.summary.pendingConflicts, 2);
  assert.deepEqual(conflicts.map((block) => block.actions.map((action) => action.id)), [
    ["apply-ours", "ignore-ours", "apply-theirs", "ignore-theirs"],
    ["apply-ours", "ignore-ours", "apply-theirs", "ignore-theirs"],
  ]);

  for (const block of model.snapshots().filter((snapshot) => snapshot.oursChanged && snapshot.theirsChanged)) {
    model.applyDecision("ours", "ignored", block.ours, fixture.result);
    model.applyDecision("theirs", "ignored", block.theirs, fixture.result);
  }
  assert.equal(projectConflictDiff(model.snapshots()).summary.pendingConflicts, 0);
});

test("one marker group keeps separated two-sided edits as independent decisions", () => {
  const fixture = separatedEditsInOneMarkerFixture();
  const model = ConflictResolutionModel.create(
    fixture.base,
    fixture.ours,
    fixture.theirs,
    fixture.result,
    fixture.worktree,
  );
  const blocks = model.snapshots();
  const review = projectConflictDiff(blocks);

  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map((block) => block.markerGroup), [0, 0]);
  assert.equal(review.summary.authoritativeConflicts, 1);
  assert.equal(review.summary.pendingConflicts, 2);

  const firstControlRange = {
    from: blocks[0].ours.from,
    to: blocks[0].ours.from + "alpha ours".length,
  };
  const afterFirst = applyModelDecision(model, "ours", "accepted", firstControlRange, fixture.result);
  assert.match(afterFirst, /alpha ours/u);
  assert.doesNotMatch(afterFirst, /omega ours/u);
  assert.equal(model.snapshots()[0].oursDecision, "accepted");
  assert.equal(model.snapshots()[1].oursDecision, "pending");
  assert.equal(projectConflictDiff(model.snapshots()).summary.pendingConflicts, 2);

  const ignored = ConflictResolutionModel.create(
    fixture.base,
    fixture.ours,
    fixture.theirs,
    fixture.result,
    fixture.worktree,
  );
  ignored.applyDecision("ours", "ignored", firstControlRange, fixture.result);
  assert.equal(ignored.snapshots()[0].oursDecision, "ignored");
  assert.equal(ignored.snapshots()[1].oursDecision, "pending");
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

function transactionChanges(transaction) {
  const changes = [];
  transaction.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    changes.push({ from, to, insert: inserted.toString() });
  });
  return changes;
}

function repeatedAddAddFixture() {
  const opening = "<".repeat(7);
  const separator = "=".repeat(7);
  const closing = ">".repeat(7);
  const base = "void main() {\n  existing();\n}\n";
  const ours = `void main() {
  existing();

  testUsingContext(() {
    sharedOne();
    oursOne();
  });

  testUsingContext(() {
    sharedTwo();
    oursTwoA();
    oursTwoB();
  });
}
`;
  const theirs = `void main() {
  existing();

  testUsingContext(() {
    sharedOne();
    theirsOneA();
    theirsOneB();
  });

  testUsingContext(() {
    sharedTwo();
    theirsTwo();
  });
}
`;
  const worktree = `void main() {
  existing();

  testUsingContext(() {
    sharedOne();
${opening} HEAD
    oursOne();
${separator}
    theirsOneA();
    theirsOneB();
${closing} topic
  });

  testUsingContext(() {
    sharedTwo();
${opening} HEAD
    oursTwoA();
    oursTwoB();
${separator}
    theirsTwo();
${closing} topic
  });
}
`;
  const result = `void main() {
  existing();

  testUsingContext(() {
    sharedOne();
  });

  testUsingContext(() {
    sharedTwo();
  });
}
`;
  return { base, ours, theirs, worktree, result };
}

function separatedEditsInOneMarkerFixture() {
  const opening = "<".repeat(7);
  const separator = "=".repeat(7);
  const closing = ">".repeat(7);
  const base = `head
alpha base
shared
omega base
tail
`;
  const ours = `head
alpha ours
shared
omega ours
tail
`;
  const theirs = `head
alpha theirs
shared
omega theirs
tail
`;
  const worktree = `head
${opening} HEAD
alpha ours
shared
omega ours
${separator}
alpha theirs
shared
omega theirs
${closing} topic
tail
`;
  return { base, ours, theirs, worktree, result: base };
}
