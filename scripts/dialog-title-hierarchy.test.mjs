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

test("shared dialog and command-surface close targets sit near the right edge", async () => {
  const [overlays, remotePush, shell] = await Promise.all([
    readFile(path.join(ROOT, "src", "shared", "overlays.css"), "utf8"),
    readFile(path.join(ROOT, "src", "features", "remote-push", "remote-push.css"), "utf8"),
    readFile(path.join(ROOT, "src", "shell", "shell.css"), "utf8"),
  ]);
  assert.match(overlays, /--dialog-close-edge-offset:\s*-10px/u);
  assert.match(overlays, /\.dialog-heading > \.icon-button\s*\{[^}]*margin-right:\s*var\(--dialog-close-edge-offset\)/su);
  assert.match(remotePush, /\.dialog\.push-diff-dialog\s*\{[^}]*--dialog-close-edge-offset:\s*-4px/su);
  assert.match(shell, /\.command-surface-close\s*\{[^}]*width:\s*30px;[^}]*height:\s*30px;[^}]*margin:\s*1px -2px 0 0;/su);
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
