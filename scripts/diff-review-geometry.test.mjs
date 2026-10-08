import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildDiffReviewCollapseRanges } from "../src/shared/diff-review/diff-review-collapse.ts";
import {
  buildDiffReviewConnectorPath,
  diffReviewOverlayFrame,
} from "../src/shared/diff-review/diff-review-geometry.ts";

test("two-pane and three-pane folds share one anchor-owned id set", () => {
  const baseLines = Array.from({ length: 100 }, (_, index) => `line ${index}`);
  const before = `${baseLines.join("\n")}\n`;
  const afterLines = [...baseLines];
  const thirdLines = [...baseLines];
  afterLines[12] = "after change";
  thirdLines.splice(55, 0, "third insertion");

  const twoPane = buildDiffReviewCollapseRanges(before, {
    before,
    after: `${afterLines.join("\n")}\n`,
  });
  const threePane = buildDiffReviewCollapseRanges(before, {
    ours: `${afterLines.join("\n")}\n`,
    result: before,
    theirs: `${thirdLines.join("\n")}\n`,
  });

  assert.deepEqual(twoPane.before.map(({ id, lines }) => ({ id, lines })), twoPane.after.map(({ id, lines }) => ({ id, lines })));
  assert.deepEqual(threePane.ours.map(({ id, lines }) => ({ id, lines })), threePane.result.map(({ id, lines }) => ({ id, lines })));
  assert.deepEqual(threePane.result.map(({ id, lines }) => ({ id, lines })), threePane.theirs.map(({ id, lines }) => ({ id, lines })));
});

test("connector geometry joins complete source and target block boundaries", () => {
  const path = buildDiffReviewConnectorPath(
    { left: 0, right: 100, top: 20, bottom: 60 },
    { left: 160, right: 260, top: 30, bottom: 90 },
  );

  assert.match(path, /^M 100\.00 20\.00 C 130\.00 20\.00 130\.00 30\.00 160\.00 30\.00/u);
  assert.match(path, /L 160\.00 90\.00/u);
  assert.match(path, /100\.00 60\.00 Z$/u);
});

test("connector overlay is clipped to the visible code viewport", () => {
  assert.deepEqual(diffReviewOverlayFrame(
    { left: 100, right: 1_100, top: 40, bottom: 840 },
    { left: 100, right: 1_100, top: 67, bottom: 828 },
  ), {
    left: 0,
    top: 27,
    width: 1_000,
    height: 761,
    pageLeft: 100,
    pageTop: 67,
  });
  assert.deepEqual(diffReviewOverlayFrame(
    { left: 100, right: 1_100, top: 40, bottom: 840 },
    { left: 1_200, right: 1_300, top: 900, bottom: 1_000 },
  ), {
    left: 1_100,
    top: 860,
    width: 0,
    height: 0,
    pageLeft: 1_200,
    pageTop: 900,
  });
});

test("geometry overlays coalesce updates without painting colored boundary strokes", async () => {
  const [overlaySource, geometrySource, styles] = await Promise.all([
    readFile(new URL("../src/shared/diff-review/diff-review-overlay.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/diff-review/diff-review-geometry.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/diff-review.css", import.meta.url), "utf8"),
  ]);
  assert.match(overlaySource, /requestAnimationFrame/u);
  assert.match(overlaySource, /addEventListener\("scroll", listener, \{ passive: true, capture: true \}\)/u);
  assert.match(overlaySource, /diffReviewOverlayFrame/u);
  assert.match(overlaySource, /this\.svg\.style\.display = "none"/u);
  assert.match(geometrySource, /coordsAtPos/u);
  assert.match(geometrySource, /getBoundingClientRect/u);
  assert.doesNotMatch(`${overlaySource}\n${geometrySource}`, /querySelector\([^)]*cm-/u);
  assert.match(styles, /\.diff-review-connector\s*\{[^}]*fill:/s);
  assert.match(styles, /\.diff-review-overlay\s*\{[^}]*overflow: hidden/s);
  assert.doesNotMatch(styles, /^\s*stroke(?:-width)?:/mu);
});
