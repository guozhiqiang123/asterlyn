import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { SearchQuery } from "@codemirror/search";

import { toggleEditorSearchOption } from "../src/editor-search.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

test("editor search options preserve one query while toggling independent modes", () => {
  const initial = new SearchQuery({ search: "alpha\\nbeta", replace: "value", literal: true });
  const newLine = toggleEditorSearchOption(initial, "newLine");
  const caseSensitive = toggleEditorSearchOption(newLine, "caseSensitive");
  const wholeWord = toggleEditorSearchOption(caseSensitive, "wholeWord");
  const regexp = toggleEditorSearchOption(wholeWord, "regexp");

  assert.equal(newLine.literal, false);
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
