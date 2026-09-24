import assert from "node:assert/strict";
import test from "node:test";

import {
  commandHighlightRanges,
  filePathHighlightRanges,
} from "../src/features/files-editor/navigation-highlights.ts";

const defaultOptions = { caseSensitive: false, wholeWord: false, regexp: false };

test("Quick Open highlights the basename match preferred by ranking", () => {
  const path = "config/app/config.ts";
  const ranges = filePathHighlightRanges(path, "config", defaultOptions);
  assert.deepEqual(ranges, [{ from: 11, to: 17 }]);
  assert.equal(path.slice(ranges[0].from, ranges[0].to), "config");
});

test("Quick Open highlights ordered fuzzy characters and honors match modes", () => {
  const path = "src/ProjectTree.ts";
  assert.deepEqual(filePathHighlightRanges(path, "ptree", defaultOptions), [
    { from: 4, to: 5 }, { from: 10, to: 11 }, { from: 12, to: 15 },
  ]);
  assert.deepEqual(filePathHighlightRanges(path, "project", {
    caseSensitive: true, wholeWord: false, regexp: false,
  }), []);
  assert.deepEqual(filePathHighlightRanges(path, "Project", {
    caseSensitive: true, wholeWord: false, regexp: false,
  }), [{ from: 4, to: 11 }]);
  assert.deepEqual(filePathHighlightRanges(path, "Tree", {
    caseSensitive: false, wholeWord: true, regexp: false,
  }), []);
  assert.deepEqual(filePathHighlightRanges("src/app-shell.ts", "app", {
    caseSensitive: false, wholeWord: true, regexp: false,
  }), [{ from: 4, to: 7 }]);
  assert.deepEqual(filePathHighlightRanges(path, "Project.*\\.ts", {
    caseSensitive: true, wholeWord: false, regexp: true,
  }), [{ from: 4, to: path.length }]);
  assert.deepEqual(filePathHighlightRanges(path, "[", {
    caseSensitive: true, wholeWord: false, regexp: true,
  }), []);
});

test("highlight offsets remain in original UTF-16 text after case folding", () => {
  const path = "src/İmage.ts";
  assert.deepEqual(filePathHighlightRanges(path, "i̇m", defaultOptions), [{ from: 4, to: 6 }]);
});

test("Commands identify visible matches and hidden alias-only matches", () => {
  const command = {
    id: "find-workspace", label: "Find in Files", detail: "Search project text",
    keywords: "workspace replace", enabled: true,
  };
  const visible = commandHighlightRanges(command, "files");
  assert.deepEqual(visible.label, [{ from: 8, to: 13 }]);
  assert.deepEqual(visible.detail, []);
  assert.deepEqual(visible.keywords, []);
  const alias = commandHighlightRanges(command, "replace");
  assert.deepEqual(alias.label, []);
  assert.deepEqual(alias.keywords, [{ from: 10, to: 17 }]);
  const empty = commandHighlightRanges(command, "");
  assert.deepEqual(empty, { label: [], detail: [], keywords: [], id: [] });
});
