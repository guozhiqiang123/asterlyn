import assert from "node:assert/strict";
import test from "node:test";

import {
  MARKDOWN_MODE_DOCUMENT_LIMIT,
  MARKDOWN_MODE_PREFERENCES_KEY,
  loadMarkdownModePreferences,
  markdownModeForDocument,
  rememberMarkdownMode,
  saveMarkdownModePreferences,
} from "../src/workbench/markdown-mode-preferences.ts";

function memoryStorage(initial = new Map()) {
  return {
    values: initial,
    getItem(key) {
      return this.values.get(key) ?? null;
    },
    setItem(key, value) {
      this.values.set(key, value);
    },
  };
}

test("a remembered document mode survives serialization and becomes the new-document default", () => {
  const storage = memoryStorage();
  let preferences = loadMarkdownModePreferences(storage);
  assert.equal(markdownModeForDocument(preferences, "file-a"), "source");

  preferences = rememberMarkdownMode(preferences, "file-a", "split");
  saveMarkdownModePreferences(storage, preferences);
  const restored = loadMarkdownModePreferences(storage);

  assert.equal(markdownModeForDocument(restored, "file-a"), "split");
  assert.equal(markdownModeForDocument(restored, "new-file"), "split");
});

test("document choices remain independent while last used supplies only the fallback", () => {
  let preferences = loadMarkdownModePreferences(memoryStorage());
  preferences = rememberMarkdownMode(preferences, "file-a", "split");
  preferences = rememberMarkdownMode(preferences, "file-b", "preview");

  assert.equal(markdownModeForDocument(preferences, "file-a"), "split");
  assert.equal(markdownModeForDocument(preferences, "file-b"), "preview");
  assert.equal(markdownModeForDocument(preferences, "file-c"), "preview");
});

test("corrupt input fails closed and retained document identities stay bounded", () => {
  const storage = memoryStorage(
    new Map([[MARKDOWN_MODE_PREFERENCES_KEY, "{not-json"]]),
  );
  let preferences = loadMarkdownModePreferences(storage);
  assert.equal(preferences.lastUsed, "source");

  for (let index = 0; index <= MARKDOWN_MODE_DOCUMENT_LIMIT; index += 1) {
    preferences = rememberMarkdownMode(preferences, `file-${index}`, "split");
  }
  assert.equal(preferences.documents.size, MARKDOWN_MODE_DOCUMENT_LIMIT);
  assert.equal(preferences.documents.has("file-0"), false);
  assert.equal(preferences.documents.has(`file-${MARKDOWN_MODE_DOCUMENT_LIMIT}`), true);
});

test("unknown modes and unavailable storage fall back without blocking editing", () => {
  const invalid = memoryStorage(
    new Map([
      [
        MARKDOWN_MODE_PREFERENCES_KEY,
        JSON.stringify({
          version: 1,
          lastUsed: "wysiwyg",
          documents: [["valid.md", "preview"], ["invalid.md", "wysiwyg"]],
        }),
      ],
    ]),
  );
  const restored = loadMarkdownModePreferences(invalid);
  assert.equal(restored.lastUsed, "source");
  assert.equal(markdownModeForDocument(restored, "valid.md"), "preview");
  assert.equal(markdownModeForDocument(restored, "invalid.md"), "source");

  const unavailable = {
    getItem() {
      throw new Error("storage unavailable");
    },
    setItem() {
      throw new Error("storage unavailable");
    },
  };
  const fallback = loadMarkdownModePreferences(unavailable);
  assert.equal(markdownModeForDocument(fallback, "file.md"), "source");
  assert.doesNotThrow(() =>
    saveMarkdownModePreferences(
      unavailable,
      rememberMarkdownMode(fallback, "file.md", "split"),
    ),
  );
});
