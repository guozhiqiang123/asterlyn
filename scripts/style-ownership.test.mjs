import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylePaths = [
  "styles.css",
  "shared/layout.css",
  "shared/controls.css",
  "shared/presentation.css",
  "shared/content.css",
  "shared/overlays.css",
  "shared/responsive.css",
  "shell/shell.css",
  "features/settings/settings.css",
  "features/changes-commit/changes-commit.css",
  "features/files-editor/project-files.css",
  "features/files-editor/files-editor.css",
  "features/files-editor/workspace-search.css",
  "features/git-history/git-history.css",
  "features/git-history/history.css",
  "features/git-history/branches.css",
  "features/git-history/details.css",
  "features/remote-push/remote-push.css",
];

test("owned styles remain below the architecture decomposition trigger", async () => {
  for (const path of stylePaths) {
    const source = await readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
    const lines = source.split("\n").length;
    assert.ok(lines <= 800, `${path} has ${lines} lines`);
  }
});

test("the entry point installs every owned stylesheet explicitly", async () => {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  for (const path of stylePaths) {
    assert.match(main, new RegExp(`import ["']\\./${escapeRegExp(path)}["']`));
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
