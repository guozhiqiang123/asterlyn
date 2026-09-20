import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const DISALLOWED_SECONDARY_TITLE = /panel-eyebrow|content-kicker|<small\b/u;

test("production dialog title bars keep one visible title hierarchy", async () => {
  const files = await sourceFiles(path.join(ROOT, "src"));
  const violations = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const headings = source.matchAll(/class="dialog-heading(?![^"]*\bpush-diff-heading\b)[^"]*"[\s\S]*?(?=<\/div>)/gu);
    if (Array.from(headings, (match) => match[0]).some((heading) => DISALLOWED_SECONDARY_TITLE.test(heading))) {
      violations.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(violations, [], `dialog title hierarchy violations: ${violations.join(", ")}`);
});

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return entry.isFile() && target.endsWith(".ts") ? [target] : [];
  }));
  return nested.flat();
}
