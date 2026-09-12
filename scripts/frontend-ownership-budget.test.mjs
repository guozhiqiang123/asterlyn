import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

test("composition adapter delegates repository reconciliation ownership", async () => {
  const source = await readFile(path.join(repositoryRoot, "src/app.ts"), "utf8");
  assert.equal(
    source.match(/bridge\.openProject/g)?.length ?? 0,
    1,
    "project reads must enter through WindowSession after its gateway is composed",
  );
  assert.match(source, /new RepositoryIntegrationCoordinator\(/);
  assert.equal(
    source.match(/repositoryReconciliationPlan/g)?.length ?? 0,
    0,
    "slice fan-out belongs to RepositoryIntegrationCoordinator",
  );
  assert.equal(
    source.match(/windowSession\.(?:installRepository|installTracked|subscribe)\(/g)?.length ?? 0,
    0,
    "repository installation and session events belong to the integration boundary",
  );
});

test("feature and shell boundaries stay below the decomposition trigger", async () => {
  const files = await typescriptFiles([
    path.join(repositoryRoot, "src/application"),
    path.join(repositoryRoot, "src/adapters"),
    path.join(repositoryRoot, "src/features"),
    path.join(repositoryRoot, "src/protocol"),
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
