import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("editable and conflict controls share one action-button renderer", async () => {
  const [editable, conflict, actions] = await Promise.all([
    readFile(new URL("../src/editable-diff-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/conflict-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/diff-review/diff-review-action-gutter.ts", import.meta.url), "utf8"),
  ]);

  assert.match(editable, /createDiffReviewActionButton/u);
  assert.match(editable, /syncDiffReviewActionButton/u);
  assert.match(conflict, /createDiffReviewActionGroup/u);
  assert.match(actions, /dataset\.reviewAction/u);
  assert.match(actions, /aria-pressed/u);
});

test("conflict review state is decorated in every registered pane", async () => {
  const [conflict, decoration, styles] = await Promise.all([
    readFile(new URL("../src/conflict-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/diff-review/diff-review-block-decoration.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/diff-review.css", import.meta.url), "utf8"),
  ]);

  assert.match(conflict, /setDiffReviewBlockDecorations\.of/u);
  assert.match(conflict, /paneReviewStatus/u);
  assert.match(decoration, /cm-diff-review-\$\{block\.status\}/u);
  for (const state of ["pending", "accepted", "ignored", "manual", "active"]) {
    assert.match(styles, new RegExp(`cm-diff-review-${state}`));
  }
});
