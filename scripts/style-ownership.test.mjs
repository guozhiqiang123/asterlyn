import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ownedStyles = [
  ["styles.css", "main.ts"],
  ["shared/layout.css", "main.ts"],
  ["shared/controls.css", "main.ts"],
  ["shared/select-control.css", "main.ts"],
  ["shared/presentation.css", "main.ts"],
  ["shared/content.css", "main.ts"],
  ["shared/overlays.css", "main.ts"],
  ["shared/context-menu/context-menu.css", "main.ts"],
  ["shared/responsive.css", "main.ts"],
  ["shell/shell.css", "main.ts"],
  ["features/settings/settings.css", "main.ts"],
  ["features/changes-commit/changes-commit.css", "main.ts"],
  ["features/files-editor/project-files.css", "main.ts"],
  ["features/files-editor/files-editor.css", "main.ts"],
  ["features/files-editor/workspace-search.css", "main.ts"],
  ["features/git-history/git-history.css", "main.ts"],
  ["features/git-history/history.css", "main.ts"],
  ["features/git-history/branches.css", "main.ts"],
  ["features/git-history/branch-mutation.css", "main.ts"],
  ["features/git-history/commit-file-restore.css", "main.ts"],
  ["features/git-history/details.css", "main.ts"],
  ["features/remote-push/remote-push.css", "main.ts"],
  ["features/remote-push/remote-authentication.css", "main.ts"],
  ["features/git-operations/git-operation-controls.css", "main.ts"],
  [
    "features/git-operations/git-operations.css",
    "features/git-operations/git-operation-dialog-entry.ts",
  ],
];

const sourceRoot = path.resolve(import.meta.dirname, "../src");

test("every production stylesheet has exactly one declared entry point", async () => {
  const styles = (await filesWithExtension(sourceRoot, ".css"))
    .map((file) => portablePath(path.relative(sourceRoot, file)))
    .sort();
  const declarations = ownedStyles.map(([style]) => style).sort();
  assert.deepEqual(declarations, styles, "ownedStyles must enumerate every src stylesheet exactly once");

  const imports = await stylesheetImports(await filesWithExtension(sourceRoot, ".ts"));
  for (const [style, expectedOwner] of ownedStyles) {
    assert.deepEqual(
      imports.get(style) ?? [],
      [expectedOwner],
      `${style} must be imported by exactly ${expectedOwner}`,
    );
  }
});

test("owned styles remain below the architecture decomposition trigger", async () => {
  for (const [path] of ownedStyles) {
    const source = await readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
    const lines = source.split("\n").length;
    assert.ok(lines <= 800, `${path} has ${lines} lines`);
  }
});

test("each owned stylesheet has one explicit entry point", async () => {
  for (const [path, owner] of ownedStyles) {
    const source = await readFile(new URL(`../src/${owner}`, import.meta.url), "utf8");
    const ownerDirectory = owner.includes("/") ? owner.slice(0, owner.lastIndexOf("/") + 1) : "";
    const relativePath = path.startsWith(ownerDirectory)
      ? `./${path.slice(ownerDirectory.length)}`
      : `./${path}`;
    assert.match(
      source,
      new RegExp(`import ["']${escapeRegExp(relativePath)}["']`),
      `${path} is not installed by ${owner}`,
    );
  }
});

test("native macOS chrome keeps the trailing settings action inset from the window edge", async () => {
  const source = await readFile(new URL("../src/shell/shell.css", import.meta.url), "utf8");
  assert.match(
    source,
    /\.platform-macos-native \.topbar-actions\s*\{[^}]*padding-right:\s*8px;/s,
  );
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function filesWithExtension(root, extension) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesWithExtension(target, extension));
    else if (entry.isFile() && entry.name.endsWith(extension)) files.push(target);
  }
  return files;
}

async function stylesheetImports(files) {
  const imports = new Map();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/\bimport\s+["']([^"']+\.css)["']/g)) {
      if (!match[1].startsWith(".")) continue;
      const target = path.resolve(path.dirname(file), match[1]);
      if (!target.startsWith(`${sourceRoot}${path.sep}`)) continue;
      const style = portablePath(path.relative(sourceRoot, target));
      const owner = portablePath(path.relative(sourceRoot, file));
      imports.set(style, [...(imports.get(style) ?? []), owner]);
    }
  }
  for (const owners of imports.values()) owners.sort();
  return imports;
}

function portablePath(value) {
  return value.split(path.sep).join("/");
}
