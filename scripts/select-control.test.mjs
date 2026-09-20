import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { renderSelectControl } from "../src/shared/select-control.ts";
import {
  themedSelectNextIndex,
  themedSelectOpeningIndex,
  themedSelectPlacement,
  themedSelectTypeaheadIndex,
} from "../src/shared/themed-select-host.ts";

test("shared select control preserves the form control and supplies one custom indicator", () => {
  const html = renderSelectControl(
    '<select id="sample" aria-label="Sample" disabled><option selected>One</option></select>',
  );

  assert.match(html, /^<span class="select-control"><select/);
  assert.match(html, /id="sample"/);
  assert.match(html, /disabled/);
  assert.match(html, /select-control-chevron/);
  assert.match(html, /aria-hidden="true"/);
});

test("theme-owned popup stays inside the viewport and prefers available space", () => {
  assert.deepEqual(
    themedSelectPlacement(
      { left: 180, right: 280, top: 160, bottom: 190, width: 100 },
      120,
      { width: 300, height: 240 },
    ),
    { left: 176, top: 36, width: 120 },
  );
  assert.deepEqual(
    themedSelectPlacement(
      { left: 8, right: 108, top: 10, bottom: 40, width: 100 },
      80,
      { width: 300, height: 240 },
    ),
    { left: 8, top: 44, width: 120 },
  );
});

test("theme-owned popup keyboard navigation skips disabled choices", () => {
  const disabled = [false, true, false];
  assert.equal(themedSelectNextIndex(disabled, 0, "ArrowDown"), 2);
  assert.equal(themedSelectNextIndex(disabled, 2, "ArrowDown"), 0);
  assert.equal(themedSelectNextIndex(disabled, 0, "ArrowUp"), 2);
  assert.equal(themedSelectOpeningIndex(disabled, 1, "Enter"), 2);
  assert.equal(
    themedSelectTypeaheadIndex(["Origin", "Blocked", "Upstream"], disabled, 2, "or"),
    0,
  );
});

test("every application select is installed through the shared visual control", async () => {
  const paths = [
    "src/shell/shell-view.ts",
    "src/features/settings/settings-view.ts",
    "src/features/files-editor/workspace-navigation-view.ts",
    "src/features/git-operations/git-operation-view.ts",
    "src/features/remote-push/remote-push-view.ts",
  ];

  for (const path of paths) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    const selects = source.match(/<select\b/g)?.length ?? 0;
    const controls = source.match(/renderSelectControl\(`/g)?.length ?? 0;
    assert.equal(controls, selects, `${path} contains an unwrapped select`);
  }
});
