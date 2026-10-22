import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { ICON_NAMES, icon } from "../src/icons.ts";

const sourceRoot = path.resolve(import.meta.dirname, "../src");

test("every static icon reference resolves to non-empty SVG content", async () => {
  const available = new Set(ICON_NAMES);
  const references = new Map();
  for (const file of await sourceFiles(sourceRoot)) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/\bicon\("([^"]+)"/gu)) {
      const name = match[1];
      const locations = references.get(name) ?? [];
      locations.push(path.relative(sourceRoot, file));
      references.set(name, locations);
    }
  }

  const missing = [...references]
    .filter(([name]) => !available.has(name))
    .map(([name, files]) => `${name}: ${[...new Set(files)].join(", ")}`);
  assert.deepEqual(missing, [], "static icon references must exist in the icon registry");

  for (const name of available) {
    const rendered = icon(name);
    const body = rendered.match(/<svg[^>]*>([\s\S]*)<\/svg>/u)?.[1] ?? "";
    assert.ok(body && !body.includes("undefined"), `${name} must render SVG content`);
  }
});

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(target);
  }
  return files;
}
