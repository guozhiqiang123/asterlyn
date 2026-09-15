import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const sourceRoot = path.join(root, "src");
const literalPattern = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;

test("component styles use the semantic color registry", async () => {
  const files = (await sourceFiles(sourceRoot)).filter((file) => file.endsWith(".css"));
  const violations = [];
  for (const file of files) {
    if (file === path.join(sourceRoot, "styles.css")) continue;
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(literalPattern)) {
      violations.push(`${path.relative(root, file)}:${lineAt(source, match.index ?? 0)} ${match[0]}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("light theme overrides every color token declared by the dark registry", async () => {
  const source = await readFile(path.join(sourceRoot, "styles.css"), "utf8");
  const rootBlock = source.match(/:root \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const lightBlock = source.match(/:root\[data-theme="light"\] \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const colorTokens = [...rootBlock.matchAll(/^\s*(--[\w-]+):\s*(#[\da-f]+|rgb\()/gim)]
    .map((match) => match[1]);
  const lightTokens = new Set(
    [...lightBlock.matchAll(/^\s*(--[\w-]+):/gm)].map((match) => match[1]),
  );
  assert.ok(colorTokens.length > 80, "semantic color registry unexpectedly small");
  assert.deepEqual(colorTokens.filter((token) => !lightTokens.has(token)), []);
});

test("Diff line fills remain opaque and visibly distinct in both themes", async () => {
  const source = await readFile(path.join(sourceRoot, "styles.css"), "utf8");
  const rootBlock = source.match(/:root \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const lightBlock = source.match(/:root\[data-theme="light"\] \{([\s\S]*?)\n\}/)?.[1] ?? "";

  for (const [theme, block, minimumContrast] of [
    ["dark", rootBlock, 1.4],
    ["light", lightBlock, 1.15],
  ]) {
    const background = colorToken(block, "--bg-deep");
    for (const token of ["--editor-diff-added-bg", "--editor-diff-removed-bg"]) {
      const value = colorToken(block, token);
      assert.match(value, /^#[\da-f]{6}$/i, `${theme} ${token} must not be alpha-blended`);
      assert.ok(
        contrastRatio(value, background) >= minimumContrast,
        `${theme} ${token} is not distinct enough from the editor background`,
      );
    }
  }
});

test("CodeMirror active line and gutter use one continuous fill", async () => {
  const source = await readFile(path.join(sourceRoot, "editor-theme.ts"), "utf8");
  assert.match(
    source,
    /"\.cm-activeLineGutter": \{ backgroundColor: "var\(--editor-active-line\)" \}/u,
  );
  assert.match(
    source,
    /"\.cm-activeLine": \{ backgroundColor: "var\(--editor-active-line\)" \}/u,
  );
});

test("Git Blame and Diff gutters use semantic background layers", async () => {
  const source = await readFile(path.join(sourceRoot, "editor-theme.ts"), "utf8");
  for (const className of [
    "cm-git-blame-tone-0",
    "cm-git-blame-tone-1",
    "cm-git-blame-tone-2",
    "cm-git-blame-tone-3",
    "cm-git-blame-local",
    "cm-source-added-gutter",
    "cm-source-removed-gutter",
    "cm-source-spacer-gutter",
    "cm-source-omitted-gutter",
  ]) {
    assert.match(source, new RegExp(`"\\.${className}"`));
  }
  assert.match(source, /var\(--editor-diff-added-bg\)/u);
  assert.match(source, /var\(--editor-diff-removed-bg\)/u);
});

test("forced-colors preserves native controls, focus, and selected state", async () => {
  const source = await readFile(path.join(sourceRoot, "styles.css"), "utf8");
  const block = source.match(/@media \(forced-colors: active\) \{([\s\S]*?)\n\}/u)?.[1] ?? "";
  assert.match(block, /button:focus-visible/u);
  assert.match(block, /\[aria-selected="true"\]/u);
  assert.match(block, /forced-color-adjust: auto/u);
  assert.doesNotMatch(block, /outline:\s*(?:0|none)/u);
});

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const resolved = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(resolved) : [resolved];
  }));
  return nested.flat();
}

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function colorToken(block, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = block.match(new RegExp(`^\\s*${escaped}:\\s*(#[\\da-f]+)`, "im"))?.[1];
  assert.ok(value, `${name} is missing from the color registry`);
  return value;
}

function contrastRatio(left, right) {
  const luminance = [relativeLuminance(left), relativeLuminance(right)]
    .sort((a, b) => b - a);
  return (luminance[0] + 0.05) / (luminance[1] + 0.05);
}

function relativeLuminance(hex) {
  const channels = [1, 3, 5]
    .map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
