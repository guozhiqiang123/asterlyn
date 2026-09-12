import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ownedStyles = [
  ["styles.css", "main.ts"],
  ["shared/layout.css", "main.ts"],
  ["shared/controls.css", "main.ts"],
  ["shared/presentation.css", "main.ts"],
  ["shared/content.css", "main.ts"],
  ["shared/overlays.css", "main.ts"],
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
  ["features/git-history/details.css", "main.ts"],
  ["features/remote-push/remote-push.css", "main.ts"],
  ["features/git-operations/git-operation-controls.css", "main.ts"],
  [
    "features/git-operations/git-operations.css",
    "features/git-operations/git-operation-dialog-entry.ts",
  ],
];

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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
