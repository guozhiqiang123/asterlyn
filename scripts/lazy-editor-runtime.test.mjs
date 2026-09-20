import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the startup graph reaches CodeMirror editors only through dynamic imports", async () => {
  const app = await readFile(new URL("../src/app.ts", import.meta.url), "utf8");
  const runtime = await readFile(
    new URL("../src/features/files-editor/lazy-editor-runtime.ts", import.meta.url),
    "utf8",
  );
  const mergeRuntime = await readFile(
    new URL("../src/features/files-editor/lazy-merge-editor-runtime.ts", import.meta.url),
    "utf8",
  );
  const surface = await readFile(
    new URL("../src/features/files-editor/editor-surface.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(app, /from ["']\.\/text-editor/);
  assert.doesNotMatch(app, /from ["']\.\/diff-editor/);
  assert.match(runtime, /import\(["']\.\.\/\.\.\/text-editor\.ts["']\)/);
  assert.match(runtime, /import\(["']\.\.\/\.\.\/diff-editor\.ts["']\)/);
  assert.doesNotMatch(surface, /from ["']\.\.\/\.\.\/(?:editable-diff-editor|conflict-editor)\.ts["']/);
  assert.match(mergeRuntime, /import\(["']\.\.\/\.\.\/editable-diff-editor\.ts["']\)/);
  assert.match(mergeRuntime, /import\(["']\.\.\/\.\.\/conflict-editor\.ts["']\)/);
});

test("Markdown preview runtime is absent from the static application graph", async () => {
  const app = await readFile(new URL("../src/app.ts", import.meta.url), "utf8");
  const surface = await readFile(
    new URL("../src/features/files-editor/editor-surface.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(app, /from ["']\.\/features\/files-editor\/markdown-preview/);
  assert.doesNotMatch(surface, /from ["']\.\/markdown-preview/);
  assert.match(surface, /import\(["']\.\/markdown-preview\.ts["']\)/);
});

test("xterm and its stylesheet load only after Terminal activation", async () => {
  const app = await readFile(new URL("../src/app.ts", import.meta.url), "utf8");
  const view = await readFile(
    new URL("../src/features/terminal/terminal-view.ts", import.meta.url),
    "utf8",
  );
  const runtime = await readFile(
    new URL("../src/features/terminal/lazy-terminal-runtime.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(app, /from ["']@xterm\//);
  assert.match(view, /import\(["']\.\/lazy-terminal-runtime\.ts["']\)/);
  assert.match(runtime, /import\(["']@xterm\/xterm["']\)/);
  assert.match(runtime, /@xterm\/xterm\/css\/xterm\.css/);
});
