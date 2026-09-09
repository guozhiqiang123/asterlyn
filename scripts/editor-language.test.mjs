import assert from "node:assert/strict";
import test from "node:test";

import {
  EditorLanguageLoader,
  editorLanguageName,
} from "../src/editor-language.ts";
import { ASTERLYN_SYNTAX_COLORS } from "../src/editor-theme.ts";

function relativeLuminance(hex) {
  const channels = [1, 3, 5]
    .map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const values = [relativeLuminance(foreground), relativeLuminance(background)]
    .sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("language descriptions cover common editor and build files", () => {
  return Promise.all([
    ["src/app.ts", "TypeScript"],
    ["src/view.tsx", "TSX"],
    ["C:\\workspace\\Main.kt", "Kotlin"],
    ["crates/core/src/lib.rs", "Rust"],
    ["docs/README.md", "Markdown"],
    ["build.gradle", "Groovy"],
    ["Cargo.toml", "TOML"],
    ["Dockerfile", "Dockerfile"],
    ["src/APP.TS", "TypeScript"],
    ["assets/binary.unknown", "Plain Text"],
  ].map(async ([path, expected]) => {
    assert.equal(await editorLanguageName(path), expected);
  }));
});

test("language support is loaded only when requested", async () => {
  const loader = new EditorLanguageLoader();
  const result = await loader.load("src/app.ts");
  assert.equal(result?.name, "TypeScript");
  assert.equal(result?.status, "ready");
  assert.ok(result?.support);
});

test("a late parser result cannot replace the current language", async () => {
  const pending = new Map();
  const loader = new EditorLanguageLoader(async (path) => ({
    name: path,
    load: () => new Promise((resolve) => pending.set(path, resolve)),
  }));

  const oldRequest = loader.load("old.ts");
  await Promise.resolve();
  const currentRequest = loader.load("current.rs");
  await Promise.resolve();
  pending.get("old.ts")({ language: "old" });
  assert.equal(await oldRequest, null);
  pending.get("current.rs")({ language: "current" });
  assert.equal((await currentRequest)?.name, "current.rs");
});

test("parser failures fall back without failing the file open", async () => {
  const loader = new EditorLanguageLoader(async () => ({
    name: "Broken",
    load: async () => {
      throw new Error("chunk unavailable");
    },
  }));
  assert.deepEqual(await loader.load("broken.ext"), {
    name: "Broken",
    status: "failed",
    support: null,
  });
});

test("syntax token colors meet normal-text contrast on the editor background", () => {
  for (const [name, color] of Object.entries(ASTERLYN_SYNTAX_COLORS)) {
    assert.ok(
      contrastRatio(color, "#1e1f22") >= 4.5,
      `${name} does not meet 4.5:1 contrast`,
    );
  }
});
