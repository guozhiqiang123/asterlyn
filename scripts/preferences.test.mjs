import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_PREFERENCES_KEY,
  DEFAULT_APP_PREFERENCES,
  loadAppPreferences,
  saveAppPreferences,
  updateAppPreferences,
} from "../src/workbench/preferences.ts";

function memoryStorage(value = null) {
  const values = new Map(value === null ? [] : [[APP_PREFERENCES_KEY, value]]);
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, next) {
      values.set(key, next);
    },
  };
}

test("preferences load safe defaults and reject malformed persisted values", () => {
  assert.deepEqual(loadAppPreferences(memoryStorage()), DEFAULT_APP_PREFERENCES);
  assert.deepEqual(
    loadAppPreferences({
      getItem() {
        throw new Error("storage unavailable");
      },
    }),
    DEFAULT_APP_PREFERENCES,
  );
  assert.deepEqual(loadAppPreferences(memoryStorage("not json")), DEFAULT_APP_PREFERENCES);
  assert.deepEqual(
    loadAppPreferences(
      memoryStorage(
        JSON.stringify({
          version: 1,
          preferences: {
            uiFontSize: 99,
            editorFontSize: 18,
            editorLineHeight: 9,
            editorTabSize: 3,
            diffLayout: "sideways",
            showWhitespace: "yes",
          },
        }),
      ),
    ),
    { ...DEFAULT_APP_PREFERENCES, editorFontSize: 18 },
  );
});

test("preferences update only through bounded choices and round trip by version", () => {
  const storage = memoryStorage();
  const updated = updateAppPreferences(DEFAULT_APP_PREFERENCES, {
    uiFontSize: 13,
    editorFontSize: 16,
    editorLineHeight: 1.8,
    editorLetterSpacing: 0.5,
    editorIndentSize: 2,
    editorTabSize: 2,
    diffLayout: "unified",
    showWhitespace: true,
  });
  saveAppPreferences(storage, updated);
  assert.deepEqual(loadAppPreferences(storage), updated);
  assert.equal(
    updateAppPreferences(updated, { editorFontSize: 200 }).editorFontSize,
    16,
  );
  assert.equal(
    updateAppPreferences(updated, { editorLetterSpacing: 20 }).editorLetterSpacing,
    0.5,
  );
  assert.equal(
    updateAppPreferences(updated, { editorIndentSize: 3 }).editorIndentSize,
    2,
  );
});

test("version one defaults migrate to the JetBrains-aligned typography baseline", () => {
  const persisted = JSON.stringify({
    version: 1,
    preferences: {
      uiFontSize: 11,
      editorFontSize: 12,
      editorLineHeight: 1.62,
      editorTabSize: 4,
      diffLayout: "split",
      showWhitespace: false,
    },
  });
  assert.deepEqual(loadAppPreferences(memoryStorage(persisted)), DEFAULT_APP_PREFERENCES);
});

test("version two preferences gain Android Studio-aligned spacing defaults", () => {
  const persisted = JSON.stringify({
    version: 2,
    preferences: {
      uiFontSize: 14,
      editorFontSize: 18,
      editorLineHeight: 1.5,
      editorTabSize: 8,
      diffLayout: "unified",
      showWhitespace: true,
    },
  });
  assert.deepEqual(loadAppPreferences(memoryStorage(persisted)), {
    ...DEFAULT_APP_PREFERENCES,
    uiFontSize: 14,
    editorFontSize: 18,
    editorLineHeight: 1.5,
    editorTabSize: 8,
    diffLayout: "unified",
    showWhitespace: true,
  });
});
