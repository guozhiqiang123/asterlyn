import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { renderSelectControl } from "../src/shared/select-control.ts";

test("shared select control preserves the native control and supplies one custom indicator", () => {
  const html = renderSelectControl(
    '<select id="sample" aria-label="Sample" disabled><option selected>One</option></select>',
  );

  assert.match(html, /^<span class="select-control"><select/);
  assert.match(html, /id="sample"/);
  assert.match(html, /disabled/);
  assert.match(html, /select-control-chevron/);
  assert.match(html, /aria-hidden="true"/);
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
