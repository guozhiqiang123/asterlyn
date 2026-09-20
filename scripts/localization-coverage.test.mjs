import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const sourceRoot = path.resolve("src");

test("production presentation code has no unreviewed English UI literals", async () => {
  const findings = [];
  for (const file of await sourceFiles(sourceRoot)) {
    if (file.includes(`${path.sep}localization${path.sep}`)) continue;
    const lines = (await readFile(file, "utf8")).split(/\r?\n/u);
    lines.forEach((line, index) => inspectLine(line, path.basename(file), index + 1, findings));
  }
  const reviewed = new Set(REVIEWED_LITERALS.map(findingKey));
  const actual = new Set(findings.map(findingKey));
  assert.deepEqual({
    unexpected: findings.filter((finding) => !reviewed.has(findingKey(finding))),
    missingReviewedEntries: REVIEWED_LITERALS.filter((finding) => !actual.has(findingKey(finding))),
  }, { unexpected: [], missingReviewedEntries: [] });
});

const REVIEWED_LITERALS = [
  // Keystroke notation and repository syntax are language-neutral technical text.
  { file: "app.ts", kind: "html-text", text: "Ctrl/Cmd + Enter" },
  { file: "workspace-navigation-view.ts", kind: "html-text", text: "Enter" },
  { file: "workspace-navigation-view.ts", kind: "html-text", text: "Esc" },
  { file: "workspace-navigation-view.ts", kind: "attribute", text: "src/**, **/*.ts" },
  { file: "workspace-navigation-view.ts", kind: "attribute", text: "dist/**, **/*.min.js" },
  { file: "shell-view.ts", kind: "html-text", text: "Git" },
  { file: "shell-view.ts", kind: "attribute", text: "/path/to/project" },
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(target);
  }
  return files.sort();
}

function inspectLine(line, file, lineNumber, findings) {
  if (/<(?:button|code|div|em|form|h[1-6]|input|label|li|option|p|pre|section|select|small|span|strong|textarea)\b/iu.test(line)) {
    for (const match of line.matchAll(/>([^<${}`]*[A-Za-z]{3}[^<${}`]*)</gu)) {
      record(match[1], "html-text", file, lineNumber, findings);
    }
    for (const match of line.matchAll(/\b(?:aria-label|placeholder|title)=["']([^"'${}]*[A-Za-z]{3}[^"'${}]*)["']/gu)) {
      record(match[1], "attribute", file, lineNumber, findings);
    }
  }
  for (const match of line.matchAll(/\b(?:confirm|setStatus|reportWarning)\(\s*["`]([^"`$]*[A-Za-z]{3}[^"`$]*)["`]/gu)) {
    record(match[1], "call", file, lineNumber, findings);
  }
  for (const match of line.matchAll(/\.(?:ariaLabel|innerText|placeholder|textContent|title)\s*=\s*["`]([^"`$]*[A-Za-z]{3}[^"`$]*)["`]/gu)) {
    record(match[1], "assignment", file, lineNumber, findings);
  }
}

function record(text, kind, file, line, findings) {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (normalized) findings.push({ file, line, kind, text: normalized });
}

function findingKey({ file, kind, text }) {
  return `${file}\0${kind}\0${text}`;
}
