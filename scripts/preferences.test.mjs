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

const LEGACY_DEFAULTS = {
  ...DEFAULT_APP_PREFERENCES,
  locale: "en-US",
  theme: "dark",
};

test("preferences load safe defaults and reject malformed persisted values", () => {
  assert.deepEqual(loadAppPreferences(memoryStorage()), DEFAULT_APP_PREFERENCES);
  assert.deepEqual(
    loadAppPreferences({
      getItem() {
        throw new Error("storage unavailable");
      },
    }),
    LEGACY_DEFAULTS,
  );
  assert.deepEqual(loadAppPreferences(memoryStorage("not json")), LEGACY_DEFAULTS);
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
    { ...LEGACY_DEFAULTS, editorFontSize: 18 },
  );
});

test("preferences update only through bounded choices and round trip by version", () => {
  const storage = memoryStorage();
  const updated = updateAppPreferences(DEFAULT_APP_PREFERENCES, {
    locale: "zh-CN",
    theme: "light",
    uiFontSize: 13,
    editorFontFamily: "fira-code",
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
  assert.equal(
    updateAppPreferences(updated, { editorFontFamily: "unknown-font" }).editorFontFamily,
    "fira-code",
  );
  assert.equal(updateAppPreferences(updated, { locale: "fr-FR" }).locale, "zh-CN");
  assert.equal(updateAppPreferences(updated, { theme: "sepia" }).theme, "light");
});

test("version one defaults migrate to the bundled editor typography baseline", () => {
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
  assert.deepEqual(loadAppPreferences(memoryStorage(persisted)), LEGACY_DEFAULTS);
});

test("version two preferences gain the current editor spacing defaults", () => {
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
    ...LEGACY_DEFAULTS,
    uiFontSize: 14,
    editorFontSize: 18,
    editorLineHeight: 1.5,
    editorTabSize: 8,
    diffLayout: "unified",
    showWhitespace: true,
  });
});

test("version three untouched typography defaults migrate without replacing custom values", () => {
  const oldDefaults = JSON.stringify({
    version: 3,
    preferences: {
      uiFontSize: 13,
      editorFontSize: 13,
      editorLineHeight: 1.2,
      editorLetterSpacing: 0,
      editorIndentSize: 4,
      editorTabSize: 4,
      diffLayout: "split",
      showWhitespace: false,
    },
  });
  assert.deepEqual(loadAppPreferences(memoryStorage(oldDefaults)), LEGACY_DEFAULTS);

  const customized = JSON.stringify({
    version: 3,
    preferences: {
      uiFontSize: 14,
      editorFontSize: 18,
      editorLineHeight: 1.5,
      editorLetterSpacing: 0.5,
      editorIndentSize: 8,
      editorTabSize: 8,
      diffLayout: "unified",
      showWhitespace: true,
    },
  });
  assert.deepEqual(loadAppPreferences(memoryStorage(customized)), {
    locale: "en-US",
    theme: "dark",
    uiFontSize: 14,
    editorFontFamily: "jetbrains-mono",
    editorFontSize: 18,
    editorLineHeight: 1.5,
    editorLetterSpacing: 0.5,
    editorIndentSize: 8,
    editorTabSize: 8,
    diffLayout: "unified",
    showWhitespace: true,
  });
});

test("version six persists bounded presentation and editor choices", () => {
  const selected = {
    ...DEFAULT_APP_PREFERENCES,
    editorFontFamily: "cascadia-code",
  };
  const storage = memoryStorage();
  saveAppPreferences(storage, selected);
  assert.deepEqual(loadAppPreferences(storage), selected);

  const malformed = JSON.stringify({
    version: 5,
    preferences: {
      ...selected,
      editorFontFamily: "file:///tmp/untrusted.woff2",
    },
  });
  assert.equal(
    loadAppPreferences(memoryStorage(malformed)).editorFontFamily,
    "jetbrains-mono",
  );
  assert.equal(loadAppPreferences(memoryStorage(malformed)).locale, "en-US");
  assert.equal(loadAppPreferences(memoryStorage(malformed)).theme, "dark");
});
