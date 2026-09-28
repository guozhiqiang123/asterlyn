import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { renderDiffControls, renderEditorTabs } from "../src/features/files-editor/editor-view.ts";
import { DEFAULT_APP_PREFERENCES } from "../src/preferences.ts";

test("the editor tab menu keeps its trailing grid column when context actions are empty", async () => {
  const css = await readFile(
    new URL("../src/features/files-editor/files-editor.css", import.meta.url),
    "utf8",
  );

  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) auto 34px/u);
  assert.doesNotMatch(css, /\.editor-context-actions:empty\s*\{[^}]*display:\s*none/gu);
});

test("Markdown Diff locks layout switching without disabling whitespace", () => {
  const html = renderDiffControls({
    imageDiff: false,
    layoutLocked: true,
    textReady: true,
    previousFile: null,
    nextFile: null,
    canOpenSource: true,
    expanded: false,
    preferences: DEFAULT_APP_PREFERENCES,
  });

  assert.match(html, /data-diff-layout="unified"[^>]* disabled/u);
  assert.match(html, /data-diff-layout="split"[^>]* disabled/u);
  assert.doesNotMatch(html, /data-diff-whitespace[^>]* disabled/u);
});

test("Diff tabs truncate the filename before their persistent Diff label", () => {
  const document = {
    kind: "working-diff",
    repositoryRoot: "/repo",
    selection: { path: "scripts/changes-context-actions.test.mjs", staged: false },
  };
  const html = renderEditorTabs({
    session: { textTabs: [], preview: document, active: { kind: "preview" } },
    document,
    statusClass: () => "file-status-modified",
  });

  assert.match(
    html,
    /editor-tab-label">changes-context-actions\.test\.mjs<\/span><small>Diff<\/small>/u,
  );
});
