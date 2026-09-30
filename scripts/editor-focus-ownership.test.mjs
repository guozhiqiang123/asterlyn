import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { readOnlyCodeMirrorFocusAttributes } from "../src/features/files-editor/editor-runtime-shared.ts";

const root = new URL("../", import.meta.url);

test("read-only CodeMirror content remains a real keyboard focus target", () => {
  assert.deepEqual(readOnlyCodeMirrorFocusAttributes(true), { tabindex: "0" });
  assert.equal(
    readOnlyCodeMirrorFocusAttributes(false),
    null,
    "editable content keeps CodeMirror's native focus behavior",
  );
});

test("every CodeMirror surface installs the shared focus-ownership contract", async () => {
  for (const file of [
    "src/text-editor.ts",
    "src/diff-editor.ts",
    "src/editable-diff-editor.ts",
    "src/conflict-editor.ts",
  ]) {
    const source = await readFile(new URL(file, root), "utf8");
    assert.ok(
      (source.match(/codeMirrorFocusOwnership/gu) ?? []).length >= 2,
      `${file} must keep read-only clicks in the editor or Diff shortcut scope`,
    );
  }
});

test("read-only Diff restores context-menu focus to CodeMirror content", async () => {
  const source = await readFile(new URL("src/diff-editor.ts", root), "utf8");
  assert.match(source, /restoreFocus:\s*\(\)\s*=>\s*\{[^}]*view\.focus\(\)/su);
  assert.doesNotMatch(source, /view\.dom\.focus\(\)/u);
});
