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
