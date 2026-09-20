import assert from "node:assert/strict";
import test from "node:test";

import {
  adjacentDiffItem,
  splitChangeBlocks,
  splitChangeStartLines,
  unifiedChangeBlocks,
  unifiedChangeStartLines,
} from "../src/features/files-editor/diff-navigation.ts";
import { editorDocumentKey } from "../src/editor-document.ts";
import { mountEditableWorkingDiff } from "../src/features/files-editor/working-diff-integration.ts";
import { readFile } from "node:fs/promises";

test("unified Diff navigation groups adjacent removed and added lines", () => {
  const patch = [
    "diff --git a/file.ts b/file.ts",
    "--- a/file.ts",
    "+++ b/file.ts",
    "@@ -1,4 +1,4 @@",
    " same",
    "-old",
    "+new",
    " same",
    "@@ -20,2 +20,2 @@",
    "-before",
    "+after",
  ].join("\n");
  assert.deepEqual(unifiedChangeStartLines(patch), [6, 10]);
  assert.deepEqual(unifiedChangeBlocks(patch), [
    { fromLine: 6, toLine: 7 },
    { fromLine: 10, toLine: 11 },
  ]);
});

test("split Diff navigation uses the first row of each change group", () => {
  const side = { lineNumber: 1, text: "", changed: [] };
  const rows = [
    { kind: "omitted", old: side, new: side },
    { kind: "removed", old: side, new: side },
    { kind: "modified", old: side, new: side },
    { kind: "context", old: side, new: side },
    { kind: "added", old: side, new: side },
  ];
  assert.deepEqual(splitChangeStartLines(rows), [2, 5]);
  assert.deepEqual(splitChangeBlocks(rows), [
    { fromLine: 2, toLine: 3 },
    { fromLine: 5, toLine: 5 },
  ]);
});

test("file navigation stops at collection boundaries", () => {
  const files = ["a", "b", "c"];
  assert.equal(adjacentDiffItem(files, "b", -1), "a");
  assert.equal(adjacentDiffItem(files, "b", 1), "c");
  assert.equal(adjacentDiffItem(files, "a", -1), null);
  assert.equal(adjacentDiffItem(files, "c", 1), null);
  assert.equal(adjacentDiffItem(files, "missing", 1), null);
});

test("Diff document identities isolate source kind, side, repository, and revision", () => {
  const working = editorDocumentKey({
    kind: "working-diff",
    repositoryRoot: "/repo",
    selection: { path: "src/file.ts", staged: false },
  });
  const staged = editorDocumentKey({
    kind: "working-diff",
    repositoryRoot: "/repo",
    selection: { path: "src/file.ts", staged: true },
  });
  const commit = editorDocumentKey({
    kind: "commit-diff",
    repositoryRoot: "/repo",
    repositoryId: ".",
    oid: "a".repeat(40),
    path: "src/file.ts",
  });
  const otherCommit = editorDocumentKey({
    kind: "commit-diff",
    repositoryRoot: "/repo",
    repositoryId: ".",
    oid: "b".repeat(40),
    path: "src/file.ts",
  });
  const comparison = editorDocumentKey({
    kind: "commit-comparison-diff",
    repositoryRoot: "/repo",
    repositoryId: ".",
    beforeOid: "a".repeat(40),
    afterOid: "b".repeat(40),
    path: "src/file.ts",
  });
  const conflict = editorDocumentKey({
    kind: "conflict-resolution",
    repositoryRoot: "/repo",
    path: "src/file.ts",
  });

  assert.equal(new Set([working, staged, commit, otherCommit, comparison, conflict]).size, 6);
  assert.match(comparison, /^comparison\0/);
  assert.match(conflict, /^conflict\0/);
});

test("editable working Diff keeps expanded state in its mount identity and runtime", () => {
  const calls = [];
  const document = {
    kind: "working-diff",
    repositoryRoot: "/repo",
    selection: { path: "src/file.ts", staged: false },
  };
  const tab = {
    id: "file-tab",
    loadEpoch: 7,
    status: "ready",
    content: "after\n",
    document: { path: "src/file.ts" },
  };
  const mounted = mountEditableWorkingDiff({
    surface: { mountEditableDiff(...args) { calls.push(args); } },
    document,
    state: {
      workingPatch: { patch: "diff", binary: false },
      workingDiffBase: { content: "before\n" },
      workingPatchVersion: 3,
    },
    tab,
    preferences: {},
    presentation: { layout: "split", showWhitespace: false },
    expandedUnchanged: true,
    beforeTransition() {},
    onContentChange() {},
  });

  assert.equal(mounted, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /\0editable:3:7:expanded$/);
  assert.equal(calls[0][5], true);
});

test("editable Diff uses one gutter marker system and can disable unchanged collapsing", async () => {
  const source = await readFile(new URL("../src/editable-diff-editor.ts", import.meta.url), "utf8");
  assert.match(source, /collapseUnchanged: this\.expandedUnchanged \? undefined/);
  assert.match(source, /\{ gutter: false \}/);
});

test("conflict editor keeps Ours and Theirs immutable around one synchronized Result", async () => {
  const source = await readFile(new URL("../src/conflict-editor.ts", import.meta.url), "utf8");
  assert.equal(source.match(/new MergeView\(/g)?.length, 2);
  assert.match(source, /revertControls: "a-to-b"/);
  assert.match(source, /revertControls: "b-to-a"/);
  assert.match(source, /resultSide === "primary"/);
  assert.match(source, /target\.dispatch\(\{ changes:/);
});

test("Diff position navigation outlines the complete current change block", async () => {
  const [editor, theme] = await Promise.all([
    readFile(new URL("../src/diff-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/editor-theme.ts", import.meta.url), "utf8"),
  ]);
  assert.match(editor, /setActiveDiffBlock\.of\(target\)/);
  assert.match(editor, /cm-diff-current-change/);
  assert.match(editor, /lineNumber === fromLine/);
  assert.match(editor, /lineNumber === toLine/);
  assert.match(theme, /\.cm-diff-current-change/);
  assert.match(theme, /\.cm-diff-current-change-start/);
  assert.match(theme, /\.cm-diff-current-change-end/);
});

test("ordinary and Diff editor content expose the shared Git Blame menu", async () => {
  const [gutterSource, textEditorSource, diffEditorSource] = await Promise.all([
    readFile(new URL("../src/features/files-editor/editor-gutter.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/text-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/diff-editor.ts", import.meta.url), "utf8"),
  ]);
  assert.match(gutterSource, /export function blameContentContextMenu/u);
  assert.match(gutterSource, /closest\("\.cm-content"\)/u);
  assert.match(textEditorSource, /blameContentContextMenu\(\(event, view\) => this\.openBlameMenu\(entry, event, view\)\)/u);
  assert.match(diffEditorSource, /blameContentContextMenu\(openBlameMenu\)/u);
});

test("split Diff projects added and removed state into every gutter", async () => {
  const source = await readFile(new URL("../src/diff-editor.ts", import.meta.url), "utf8");
  assert.match(source, /gutterLineClass\.compute/u);
  assert.match(source, /cm-source-added-gutter/u);
  assert.match(source, /cm-source-removed-gutter/u);
  assert.match(source, /cm-source-spacer-gutter/u);
  assert.match(source, /cm-source-omitted-gutter/u);
  assert.match(source, /sourceGutterDecorations\(rows, side\)/u);
});
