import assert from "node:assert/strict";
import test from "node:test";

import { buildConflictCollapseRanges } from "../src/conflict-collapse.ts";

test("three-way conflict folds share Base-owned ids and unchanged-line counts", () => {
  const baseLines = Array.from({ length: 120 }, (_, index) => `line ${index}`);
  const oursLines = [...baseLines];
  const resultLines = [...baseLines];
  const theirsLines = [...baseLines];
  oursLines[12] = "ours change";
  resultLines[12] = "neutral result";
  theirsLines[12] = "theirs change";
  theirsLines.splice(60, 0, ...Array.from({ length: 24 }, (_, index) => `theirs inserted ${index}`));

  const ranges = buildConflictCollapseRanges(
    `${baseLines.join("\n")}\n`,
    `${oursLines.join("\n")}\n`,
    `${resultLines.join("\n")}\n`,
    `${theirsLines.join("\n")}\n`,
  );

  assert.ok(ranges.result.length >= 2);
  assert.deepEqual(ranges.ours.map(({ id, lines }) => ({ id, lines })), ranges.result.map(({ id, lines }) => ({ id, lines })));
  assert.deepEqual(ranges.theirs.map(({ id, lines }) => ({ id, lines })), ranges.result.map(({ id, lines }) => ({ id, lines })));
  assert.ok(ranges.theirs.at(-1).from > ranges.result.at(-1).from, "Theirs folds map past inserted content");
});

test("short unchanged gaps stay visible in every conflict pane", () => {
  const base = "one\ntwo\nthree\nfour\nfive\n";
  const ranges = buildConflictCollapseRanges(base, "ONE\ntwo\nthree\nfour\nfive\n", base, base);
  assert.deepEqual(ranges, { ours: [], result: [], theirs: [] });
});
