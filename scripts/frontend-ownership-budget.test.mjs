import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

test("composition adapter stays below the accepted R2 concentration ceiling", async () => {
  const source = await readFile(path.join(repositoryRoot, "src/app.ts"), "utf8");
  assert.ok(
    lineCount(source) <= 6_000,
    `src/app.ts grew to ${lineCount(source)} lines; extract ownership instead of expanding it`,
  );
});

test("feature and shell boundaries stay below the decomposition trigger", async () => {
  const files = await typescriptFiles([
    path.join(repositoryRoot, "src/application"),
    path.join(repositoryRoot, "src/features"),
    path.join(repositoryRoot, "src/shell"),
  ]);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.ok(
      lineCount(source) <= 800,
      `${path.relative(repositoryRoot, file)} reached ${lineCount(source)} lines`,
    );
  }
});

test("window-wide bindings have explicit listener and observer disposal", async () => {
  const shell = await readFile(
    path.join(repositoryRoot, "src/shell/shell-event-binding.ts"),
    "utf8",
  );
  const chrome = await readFile(
    path.join(repositoryRoot, "src/shell/window-chrome-binding.ts"),
    "utf8",
  );
  assert.match(shell, /AbortController/);
  assert.match(shell, /resizeObserver\?\.disconnect\(\)/);
  assert.match(chrome, /releaseResize\?\.\(\)/);
  assert.match(chrome, /releaseCloseRequest\?\.\(\)/);
});

async function typescriptFiles(roots) {
  const files = [];
  for (const root of roots) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) files.push(...await typescriptFiles([target]));
      else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(target);
    }
  }
  return files;
}

function lineCount(source) {
  return source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
}
