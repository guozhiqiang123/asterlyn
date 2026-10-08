import assert from "node:assert/strict";
import test from "node:test";

import {
  CONFLICT_DIFF_CAPABILITIES,
  READ_ONLY_DIFF_CAPABILITIES,
} from "../src/shared/diff-review/diff-review-model.ts";
import { renderDiffReviewToolbar } from "../src/shared/diff-review/diff-review-toolbar.ts";

const copy = {
  toolbar: "Review",
  navigation: "Navigate",
  previousBlock: "Previous block",
  nextBlock: "Next block",
  previousFile: "Previous file",
  nextFile: "Next file",
  openSource: "Open source",
  collapseUnchanged: "Collapse unchanged",
  expandUnchanged: "Expand unchanged",
  presentation: "Presentation",
  unified: "Unified",
  unifiedTitle: "Unified layout",
  split: "Split",
  splitTitle: "Split layout",
  whitespace: "Whitespace",
  whitespaceTitle: "Show whitespace",
};

test("one toolbar renderer exposes the ordinary Diff capability set", () => {
  const html = renderDiffReviewToolbar({
    namespace: "editor",
    capabilities: READ_ONLY_DIFF_CAPABILITIES,
    ready: true,
    layout: "split",
    showWhitespace: true,
    expandedUnchanged: false,
    previousFileAvailable: true,
    nextFileAvailable: false,
    sourceAvailable: true,
    copy,
  });

  assert.match(html, /data-diff-action="previous-change"/);
  assert.match(html, /data-diff-action="previous-file"/);
  assert.match(html, /data-diff-layout="split" aria-pressed="true"/);
  assert.match(html, /data-diff-whitespace aria-pressed="true"/);
  assert.doesNotMatch(html, /data-push-diff-action/);
});

test("Push Diff reuses the toolbar while keeping its command target namespace", () => {
  const html = renderDiffReviewToolbar({
    namespace: "push",
    capabilities: READ_ONLY_DIFF_CAPABILITIES,
    ready: true,
    layout: "unified",
    copy,
  });

  assert.match(html, /data-push-diff-action="next-change"/);
  assert.match(html, /data-push-diff-layout="unified" aria-pressed="true"/);
});

test("conflict toolbar hides unsupported file and layout actions and announces progress", () => {
  const html = renderDiffReviewToolbar({
    namespace: "editor",
    capabilities: { ...CONFLICT_DIFF_CAPABILITIES, toggleUnchanged: false },
    ready: true,
    summary: "2 conflicts · 1 pending",
    bulkActions: {
      label: "Apply non-conflicting changes",
      ours: "Ours",
      all: "All",
      theirs: "Theirs",
    },
    showWhitespace: false,
    copy,
  });

  assert.match(html, /Previous block/);
  assert.match(html, /diff-review-summary/);
  assert.doesNotMatch(html, /previous-file/);
  assert.doesNotMatch(html, /data-diff-layout/);
  assert.match(html, /data-diff-whitespace/);
  assert.match(html, /data-diff-bulk="ours"/);
  assert.match(html, /data-diff-bulk="all"/);
  assert.match(html, /data-diff-bulk="theirs"/);
});
