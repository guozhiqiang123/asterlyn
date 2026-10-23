import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildDiffReviewCollapseRanges } from "../src/shared/diff-review/diff-review-collapse.ts";
import {
  buildDiffReviewConnectorPath,
  diffReviewOverlayFrame,
  measureDiffReviewRange,
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

test("empty Diff ranges anchor before MergeView alignment space", () => {
  const view = {
    state: {
      doc: {
        length: 20,
        lineAt(position) {
          return position < 10 ? { from: 0, to: 9 } : { from: 10, to: 20 };
        },
      },
    },
    documentTop: 100,
    lineBlockAt(position) {
      return position < 10
        ? { top: 0, bottom: 20 }
        : { top: 80, bottom: 100 };
    },
    coordsAtPos() {
      throw new Error("a line-boundary anchor must not use caret geometry");
    },
    scrollDOM: {
      getBoundingClientRect() {
        return { left: 10, right: 210, top: 90, bottom: 250 };
      },
    },
  };

  assert.deepEqual(measureDiffReviewRange(view, { from: 10, to: 10 }, { left: 0, top: 100 }), {
    left: 10,
    right: 210,
    top: 20,
    bottom: 20,
  });
});

test("empty Diff ranges use compact document-edge anchors", () => {
  const view = {
    state: {
      doc: {
        length: 20,
        lineAt(position) {
          return position < 10 ? { from: 0, to: 9 } : { from: 10, to: 20 };
        },
      },
    },
    documentTop: 100,
    lineBlockAt(position) {
      return position < 10
        ? { top: 5, bottom: 25 }
        : { top: 80, bottom: 100 };
    },
    coordsAtPos() {
      throw new Error("a document-edge anchor must not use caret geometry");
    },
    scrollDOM: {
      getBoundingClientRect() {
        return { left: 10, right: 210, top: 90, bottom: 250 };
      },
    },
  };

  assert.equal(measureDiffReviewRange(view, { from: 0, to: 0 }, { left: 0, top: 100 }).top, 5);
  assert.equal(measureDiffReviewRange(view, { from: 20, to: 20 }, { left: 0, top: 100 }).top, 100);
});

test("empty-side connectors without an alignment slot retain a compact cusp", () => {
  const path = buildDiffReviewConnectorPath(
    { left: 0, right: 100, top: 40, bottom: 40 },
    { left: 160, right: 260, top: 20, bottom: 80 },
  );

  assert.match(path, /^M 100\.00 40\.00 C 130\.00 40\.00 130\.00 20\.00 160\.00 20\.00/u);
  assert.match(path, /L 160\.00 80\.00/u);
  assert.match(path, /100\.00 40\.00 Z$/u);
  assert.doesNotMatch(path, /100\.00 42\.00/u);

  const deletion = buildDiffReviewConnectorPath(
    { left: 0, right: 100, top: 20, bottom: 80 },
    { left: 160, right: 260, top: 40, bottom: 40 },
  );
  assert.match(deletion, /^M 100\.00 20\.00 C 130\.00 20\.00 130\.00 40\.00 160\.00 40\.00/u);
  assert.match(deletion, /L 160\.00 40\.00/u);
  assert.match(deletion, /100\.00 80\.00 Z$/u);
});

function alignmentView(position, widgetType, viewport = { left: 10, right: 210, top: 90, bottom: 250 }) {
  const widget = { from: position, to: position, top: 20, bottom: 80, height: 60, type: widgetType };
  const text = { from: 10, to: 20, top: 80, bottom: 100, height: 20, type: 0 };
  return {
    state: { doc: { length: 20, lineAt() { return { from: 10, to: 20 }; } } },
    documentTop: 100,
    lineBlockAt(offset) {
      return offset < 10 ? { top: 0, bottom: 20, type: 0 }
        : { top: 20, bottom: 100, type: [widget, text] };
    },
    coordsAtPos() { throw new Error("alignment slots must remain measurable offscreen"); },
    scrollDOM: { getBoundingClientRect() { return viewport; } },
  };
}

test("empty Diff ranges fill the real alignment slot at a line boundary", () => {
  assert.deepEqual(measureDiffReviewRange(alignmentView(10, 1), { from: 10, to: 10 }, { left: 0, top: 100 }), {
    left: 10, right: 210, top: 20, bottom: 80,
  });
  // A folded replacement is not an empty alignment slot and must not add a false band.
  assert.deepEqual(measureDiffReviewRange(alignmentView(10, 3), { from: 10, to: 10 }, { left: 0, top: 100 }), {
    left: 10, right: 210, top: 20, bottom: 20,
  });
});

test("alignment connectors remain visible when their anchor scrolls above the viewport", () => {
  const view = alignmentView(10, 1, { left: 10, right: 210, top: 155, bottom: 175 });
  assert.deepEqual(measureDiffReviewRange(view, { from: 10, to: 10 }, { left: 0, top: 100 }), {
    left: 10, right: 210, top: 55, bottom: 75,
  });
});

test("end-of-document alignment starts before the trailing spacer", () => {
  const view = alignmentView(20, 2);
  view.lineBlockAt = () => ({ top: 0, bottom: 80, type: [
    { from: 10, to: 20, top: 0, bottom: 20, height: 20, type: 0 },
    { from: 20, to: 20, top: 20, bottom: 80, height: 60, type: 2 },
  ] });
  assert.deepEqual(measureDiffReviewRange(view, { from: 20, to: 20 }, { left: 0, top: 100 }), {
    left: 10, right: 210, top: 20, bottom: 80,
  });
});

test("large changed ranges keep their visible middle when endpoint DOM is virtualized", () => {
  const view = {
    state: { doc: { length: 100 } },
    documentTop: 20,
    coordsAtPos() { return null; },
    lineBlockAt(position) {
      return position < 50 ? { from: 0, to: 49, top: 0, bottom: 20, type: 0 }
        : { from: 50, to: 100, top: 500, bottom: 520, type: 0 };
    },
    scrollDOM: { getBoundingClientRect() { return { left: 10, right: 210, top: 100, bottom: 300 }; } },
  };
  assert.deepEqual(measureDiffReviewRange(view, { from: 0, to: 100 }, { left: 0, top: 100 }), {
    left: 10, right: 210, top: 0, bottom: 200,
  });
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
