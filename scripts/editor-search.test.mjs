import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { SearchQuery } from "@codemirror/search";
import { EditorState } from "@codemirror/state";

import { insertEditorSearchLineBreak, toggleEditorSearchOption } from "../src/editor-search.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

test("New line inserts a real line break at the caret and searches across editor lines", () => {
  const initial = new SearchQuery({ search: "alpha beta", replace: "value", literal: true });
  const inserted = insertEditorSearchLineBreak(initial, 5, 6);
  assert.equal(inserted.query.search, "alpha\nbeta");
  assert.equal(inserted.caret, 6);
  assert.equal(inserted.query.literal, false);
  assert.equal(inserted.query.replace, "value");
  const match = inserted.query.getCursor(EditorState.create({ doc: "alpha\nbeta alpha beta" })).next();
  assert.deepEqual({ from: match.value.from, to: match.value.to }, { from: 0, to: 10 });
  const escaped = new SearchQuery({ search: "alpha\\nbeta", literal: true });
  const multiline = insertEditorSearchLineBreak(escaped, escaped.search.length, escaped.search.length).query;
  const escapedMatch = multiline.getCursor(EditorState.create({ doc: "alpha\nbeta\n" })).next();
  assert.deepEqual({ from: escapedMatch.value.from, to: escapedMatch.value.to }, { from: 0, to: 11 });
});

test("editor search options preserve a multiline query while toggling independent modes", () => {
  const initial = new SearchQuery({ search: "alpha\nbeta", replace: "value", literal: true });
  const caseSensitive = toggleEditorSearchOption(initial, "caseSensitive");
  const wholeWord = toggleEditorSearchOption(caseSensitive, "wholeWord");
  const regexp = toggleEditorSearchOption(wholeWord, "regexp");

  assert.equal(regexp.literal, false);
  assert.equal(caseSensitive.caseSensitive, true);
  assert.equal(wholeWord.wholeWord, true);
  assert.equal(regexp.regexp, true);
  assert.equal(regexp.search, initial.search);
  assert.equal(regexp.replace, initial.replace);
});

test("ordinary, working diff, historical diff, and conflict editors share the search panel", async () => {
  for (const file of ["text-editor.ts", "editable-diff-editor.ts", "diff-editor.ts", "conflict-editor.ts"]) {
    const source = await readFile(path.join(repositoryRoot, "src", file), "utf8");
    assert.match(source, /asterlynSearch\(\)/, `${file} must install the shared search extension`);
  }
});

test("editor search aligns find and replace fields on one shared action grid", async () => {
  const [panel, theme] = await Promise.all([
    readFile(path.join(repositoryRoot, "src", "editor-search.ts"), "utf8"),
    readFile(path.join(repositoryRoot, "src", "editor-theme.ts"), "utf8"),
  ]);
  assert.equal(Array.from(panel.matchAll(/"asterlyn-search-command"/gu)).length, 5);
  assert.match(panel, /"asterlyn-search-close"/u);
  assert.match(panel, /this\.dom\.append\(searchShell, commands, close\)/u);
  assert.match(panel, /"asterlyn-search-actions asterlyn-search-replace-actions"/u);
  assert.match(panel, /actions\.append\(replace, all\)/u);
  assert.match(panel, /row\.append\(shell, actions\)/u);
  assert.match(theme, /"\.cm-panel\.cm-search": \{ padding: "8px 10px" \}/u);
  assert.match(theme, /gridTemplateColumns: "minmax\(190px, 1fr\) auto 34px"/u);
  assert.match(theme, /columnGap: "8px"/u);
  assert.match(theme, /rowGap: "8px"/u);
  assert.match(theme, /"\.asterlyn-search-replace-row": \{[^}]*display: "contents"/u);
  assert.doesNotMatch(theme, /gridColumn: "1 \/ -1"|paddingRight: "34px"/u);
  assert.match(theme, /"\.asterlyn-search-panel \.asterlyn-search-command": \{/u);
  assert.match(theme, /borderColor: "var\(--border\)"/u);
  assert.match(theme, /backgroundColor: "var\(--bg-elevated\)"/u);
  assert.match(theme, /"\.asterlyn-search-panel \.asterlyn-search-close": \{/u);
  assert.match(theme, /minWidth: "34px"/u);
  assert.match(theme, /height: "32px"/u);
  assert.match(theme, /margin: "0"/u);
  assert.match(theme, /fontSize: "18px"/u);
  assert.match(theme, /justifySelf: "end"/u);
  assert.match(theme, /\.asterlyn-search-command:active/u);
  assert.match(theme, /\.asterlyn-search-close:focus-visible/u);
});
