import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const historyCss = await readFile(new URL("../src/features/git-history/git-history.css", import.meta.url), "utf8");
const remoteCss = await readFile(new URL("../src/features/remote-push/remote-push.css", import.meta.url), "utf8");
const controlsCss = await readFile(new URL("../src/shared/controls.css", import.meta.url), "utf8");

test("selected list rows use the shared solid selection tokens without an active-edge adornment", () => {
  assert.match(historyCss, /\.history-row\.selected,[^}]*background:\s*var\(--selection-bg\)[^}]*color:\s*var\(--selection-text\)/su);
  assert.doesNotMatch(historyCss, /\.history-row\.active\s*\{[^}]*box-shadow/su);
  assert.match(remoteCss, /\.push-commit-row\.selected\s*\{[^}]*background:\s*var\(--selection-bg\)[^}]*color:\s*var\(--selection-text\)/su);
  assert.doesNotMatch(remoteCss, /\.push-commit-row\.selected\s*\{[^}]*box-shadow/su);
  assert.match(remoteCss, /\.push-file-row\.selected\s*\{[^}]*background:\s*var\(--selection-bg\)[^}]*color:\s*var\(--selection-text\)/su);
  assert.match(controlsCss, /\.host-search-result\.selected,[^}]*\{[^}]*background:\s*var\(--selection-bg\)[^}]*color:\s*var\(--selection-text\)/su);
  assert.match(controlsCss, /\.host-search-result:hover:not\(\.selected\):not\(\[aria-selected="true"\]\)\s*\{[^}]*background:\s*var\(--bg-hover\)/su);
});
