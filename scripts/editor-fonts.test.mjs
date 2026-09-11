import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_EDITOR_FONT_ID,
  EDITOR_FONTS,
  editorFontFamilyStack,
  editorFontOptionLabel,
  isEditorFontId,
} from "../src/workbench/editor-fonts.ts";

test("editor font catalog bundles one default and pins every optional asset", () => {
  assert.equal(DEFAULT_EDITOR_FONT_ID, "jetbrains-mono");
  assert.deepEqual(
    EDITOR_FONTS.filter((font) => font.bundled).map((font) => font.id),
    ["jetbrains-mono"],
  );
  assert.equal(new Set(EDITOR_FONTS.map((font) => font.id)).size, EDITOR_FONTS.length);

  for (const font of EDITOR_FONTS.filter((entry) => !entry.bundled)) {
    assert.match(font.asset.url, /^https:\/\/cdn\.jsdelivr\.net\/npm\//);
    assert.match(font.asset.url, /@5\.3\.0\//);
    assert.match(font.asset.sha256, /^[0-9a-f]{64}$/);
    assert.match(editorFontOptionLabel(font), /Download on first use$/);
  }
});

test("font ids and CSS stacks reject arbitrary persisted or remote values", () => {
  assert.equal(isEditorFontId("source-code-pro"), true);
  assert.equal(isEditorFontId("https://example.test/font.woff2"), false);
  assert.equal(isEditorFontId("system-ui"), false);
  assert.match(editorFontFamilyStack("fira-code"), /^"Asterlyn Fira Code"/);
  assert.match(editorFontFamilyStack("fira-code"), /"Noto Sans Mono CJK SC"/);
});

test("desktop packaging contains only JetBrains Mono and limits optional downloads", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  assert.equal(
    packageJson.dependencies["@fontsource-variable/jetbrains-mono"],
    "5.3.0",
  );
  assert.equal(packageJson.dependencies["@fontsource-variable/source-code-pro"], undefined);
  assert.equal(packageJson.dependencies["@fontsource-variable/cascadia-code"], undefined);
  assert.equal(packageJson.dependencies["@fontsource-variable/fira-code"], undefined);
  assert.equal(packageJson.dependencies["@fontsource/ibm-plex-mono"], undefined);

  const tauri = JSON.parse(
    readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url)),
  );
  assert.deepEqual(tauri.bundle.resources, {
    "../node_modules/@fontsource-variable/jetbrains-mono/LICENSE":
      "licenses/jetbrains-mono-OFL.txt",
  });
  assert.match(tauri.app.security.csp, /font-src 'self' data: blob:/);
  assert.match(
    tauri.app.security.csp,
    /connect-src ipc: http:\/\/ipc\.localhost https:\/\/cdn\.jsdelivr\.net/,
  );
});
