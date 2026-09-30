import assert from "node:assert/strict";
import test from "node:test";

import {
  adjacentDiffItem,
  handleOmittedDiffExpansion,
  splitChangeBlocks,
  splitChangeStartLines,
  unifiedChangeBlocks,
  unifiedChangeStartLines,
} from "../src/features/files-editor/diff-navigation.ts";
import { editorDocumentKey } from "../src/editor-document.ts";
import {
  mountEditableWorkingDiff,
  workingDiffSourceFile,
} from "../src/features/files-editor/working-diff-integration.ts";
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

test("deleted working Diffs do not expose a missing source file", () => {
  const document = {
    kind: "working-diff",
    repositoryRoot: "/repo",
    selection: { path: "removed.txt", staged: false },
  };
  const files = [{ repositoryId: ".", path: "removed.txt", workspacePath: "removed.txt" }];
  const removed = { path: "removed.txt", indexStatus: "unmodified", worktreeStatus: "deleted" };
  const stagedRemoved = { ...removed, indexStatus: "deleted", worktreeStatus: "unmodified" };
  const recreated = { ...removed, indexStatus: "deleted", worktreeStatus: "added" };

  assert.equal(workingDiffSourceFile(files, document, [removed]), null);
  assert.equal(workingDiffSourceFile(files, document, [stagedRemoved]), null);
  assert.equal(workingDiffSourceFile(files, document, [recreated]), files[0]);
});

test("clicking an omitted Diff row expands it exactly once", () => {
  let expansions = 0;
  const omitted = {
    closest(selector) {
      return selector === ".cm-source-omitted" ? this : null;
    },
  };
  const ordinary = { closest() { return null; } };

  assert.equal(handleOmittedDiffExpansion(ordinary, () => { expansions += 1; }), false);
  assert.equal(handleOmittedDiffExpansion(null, () => { expansions += 1; }), false);
  assert.equal(handleOmittedDiffExpansion(omitted, () => { expansions += 1; }), true);
  assert.equal(expansions, 1);
});

test("read-only Diff keeps the omitted-row expansion callback wired end to end", async () => {
  const [editor, lazy, surface, app] = await Promise.all([
    readFile(new URL("../src/diff-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/lazy-editor-runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/editor-surface.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app.ts", import.meta.url), "utf8"),
  ]);
  assert.match(editor, /EditorView\.domEventHandlers\(\{[\s\S]*handleOmittedDiffExpansion/u);
  assert.match(lazy, /onExpandUnchanged:\s*\(\) => void/u);
  assert.match(surface, /onExpandUnchanged:\s*\(\) => void/u);
  assert.match(app, /\(\) => this\.expandDiffUnchangedLines\(\)/u);
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
    sideLabels: { before: "Before · HEAD", after: "After · Working Tree" },
    blameSources: { old: {}, new: {}, unifiedReason: "split" },
    expandedUnchanged: true,
    beforeTransition() {},
    onContentChange() {},
  });

  assert.equal(mounted, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /\0editable:3:7:expanded$/);
  assert.deepEqual(calls[0][5], { before: "Before · HEAD", after: "After · Working Tree" });
  assert.equal(calls[0][7], true);
});

test("editable Diff uses one gutter marker system and can disable unchanged collapsing", async () => {
  const [source, highlighting] = await Promise.all([
    readFile(new URL("../src/editable-diff-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/merge-diff-highlighting.ts", import.meta.url), "utf8"),
  ]);
  assert.match(source, /collapseUnchanged: this\.expandedUnchanged \? undefined/);
  assert.match(source, /\{ gutter: false \}/);
  assert.match(source, /mergeDiffSemanticHighlighting/u);
  assert.match(highlighting, /getChunks\(update\.state\)/u);
  assert.match(highlighting, /absoluteChunkChanges\(merge\.chunks\)/u);
  assert.doesNotMatch(highlighting, /lineAwareDiff/u);
  assert.match(highlighting, /mergeViewSiblings\(view\)/u);
  assert.match(highlighting, /cm-source-word-\$\{kind\}/u);
  assert.match(highlighting, /MergeView creates pane A before pane B/u);
  assert.match(highlighting, /refreshSemanticHighlighting\.of\(null\)/u);
  assert.match(highlighting, /siblings\?\.a && siblings\.b/u);
});

test("editable Diff control synchronization cannot feed its own MutationObserver", async () => {
  const [source, actions] = await Promise.all([
    readFile(new URL("../src/editable-diff-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/diff-review/diff-review-action-gutter.ts", import.meta.url), "utf8"),
  ]);
  assert.match(source, /syncDiffReviewActionButton/u);
  assert.match(actions, /button\.dataset\.controlIcon !== iconName \|\| button\.dataset\.controlLabel !== presentation\.label/u);
  assert.match(actions, /button\.dataset\.controlIcon = iconName;/u);
  assert.match(actions, /button\.dataset\.controlLabel = presentation\.label;/u);
  assert.match(actions, /if \(button\.title !== title\) button\.title = title;/u);
  assert.match(actions, /if \(button\.disabled !== \(presentation\.disabled === true\)\)/u);
});

test("conflict editor keeps Ours and Theirs immutable around one synchronized Result", async () => {
  const source = await readFile(new URL("../src/conflict-editor.ts", import.meta.url), "utf8");
  assert.equal(source.match(/new MergeView\(/g)?.length, 2);
  assert.equal(source.match(/revertControls: "a-to-b"/g)?.length, 2);
  assert.match(source, /orientation: "b-a"/u);
  assert.match(source, /resultSide === "primary"/);
  assert.match(source, /target\.dispatch\(\{ changes \}\)/);
  assert.match(source, /mergeDiffSemanticHighlighting/u);
  assert.match(source, /ConflictResolutionModel\.create\([\s\S]*?this\.exactResult\.text,[\s\S]*?worktree,[\s\S]*?\);/u);
  assert.match(source, /conflictControls\("ours", "right", copy\)/u);
  assert.match(source, /conflictControls\("theirs", "left", copy\)/u);
  assert.match(source, /observeManualChanges\(/u);
  assert.match(source, /ConflictCollapseCoordinator/u);
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

test("ordinary and Diff editors load eligible Git Blame sources automatically", async () => {
  const [gutterSource, textEditorSource, diffEditorSource, paneControllerSource] = await Promise.all([
    readFile(new URL("../src/features/files-editor/editor-gutter.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/text-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/diff-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/git-blame-pane-controller.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(gutterSource, /contextmenu|blameContentContextMenu/u);
  assert.match(gutterSource, /view\.dom\.addEventListener\("mouseover", this\.mouseover/u);
  assert.match(gutterSource, /view\.dom\.addEventListener\("mouseout", this\.mouseout/u);
  assert.match(gutterSource, /this\.listeners\.abort\(\)/u);
  assert.match(textEditorSource, /void this\.ensureBlame\(mountedEntry\)/u);
  assert.match(diffEditorSource, /void this\.ensureBlame\("old"\)/u);
  assert.match(diffEditorSource, /void this\.ensureBlame\("new"\)/u);
  assert.match(paneControllerSource, /else void this\.ensure\(pane\)/u);
  assert.doesNotMatch(textEditorSource, /gitBlameContextSession|toggleBlame/u);
  assert.doesNotMatch(diffEditorSource, /gitBlameContextSession|toggleBlame/u);
});

test("split Diff centers line numbers and uses one stable change gutter per side", async () => {
  const [source, gutter] = await Promise.all([
    readFile(new URL("../src/diff-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/editor-gutter.ts", import.meta.url), "utf8"),
  ]);
  assert.match(source, /side === "old" \? "after" : "before"/u);
  assert.match(source, /sourceChangeGutter\(rows, side\)/u);
  assert.match(source, /cm-source-change-indicator-gutter/u);
  assert.doesNotMatch(source, /gutterLineClass\.compute/u);
  assert.match(gutter, /side: DiffGutterSide/u);
  assert.match(gutter, /cm-diff-lineNumbers-\$\{side\}/u);
});

test("merge Diff layouts preserve CodeMirror's supported outer scroll owner", async () => {
  const [editableCss, conflictCss, editable, conflict] = await Promise.all([
    readFile(new URL("../src/features/files-editor/editable-diff.css", import.meta.url), "utf8"),
    readFile(new URL("../src/features/git-operations/conflict-editor.css", import.meta.url), "utf8"),
    readFile(new URL("../src/editable-diff-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/conflict-editor.ts", import.meta.url), "utf8"),
  ]);
  assert.match(editableCss, /\.cm-mergeView \{[\s\S]*overflow: auto;/u);
  assert.match(conflictCss, /\.cm-mergeView \{[\s\S]*overflow: auto;/u);
  assert.doesNotMatch(editableCss, /\.cm-merge-a \.cm-gutters[\s\S]*order:/u);
  assert.doesNotMatch(conflictCss, /\.cm-merge-a \.cm-gutters[\s\S]*order:/u);
  assert.match(editable, /gutter: false/u);
  assert.equal(conflict.match(/gutter: false/g)?.length, 2);
  assert.match(conflict, /linkVerticalScrollByDocument\(/u);
  assert.match(conflict, /this\.leftMerge\.b,\s*this\.rightMerge\.b,/u);
  assert.match(conflict, /linkHorizontalScrollGroup\(\[\.\.\.panes, \.\.\.scrollers\]\)/u);
});
