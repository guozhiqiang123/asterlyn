import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the startup graph reaches CodeMirror editors only through dynamic imports", async () => {
  const app = await readFile(new URL("../src/app.ts", import.meta.url), "utf8");
  const runtime = await readFile(
    new URL("../src/features/files-editor/lazy-editor-runtime.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(app, /from ["']\.\/text-editor/);
  assert.doesNotMatch(app, /from ["']\.\/diff-editor/);
  assert.match(runtime, /import\(["']\.\.\/\.\.\/text-editor\.ts["']\)/);
  assert.match(runtime, /import\(["']\.\.\/\.\.\/diff-editor\.ts["']\)/);
});

test("Markdown preview runtime is absent from the static application graph", async () => {
  const app = await readFile(new URL("../src/app.ts", import.meta.url), "utf8");

  assert.doesNotMatch(app, /from ["']\.\/workbench\/markdown-preview/);
  assert.match(app, /import\(["']\.\/workbench\/markdown-preview["']\)/);
});
