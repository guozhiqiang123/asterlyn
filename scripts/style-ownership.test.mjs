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
  ["features/files-editor/editable-diff.css", "main.ts"],
  ["features/files-editor/workspace-search.css", "main.ts"],
  ["features/git-history/git-history.css", "main.ts"],
  ["features/git-history/history.css", "main.ts"],
  ["features/git-history/branches.css", "main.ts"],
  ["features/git-history/branch-mutation.css", "main.ts"],
  ["features/git-history/git-reset.css", "main.ts"],
  ["features/git-history/commit-file-restore.css", "main.ts"],
  ["features/git-history/details.css", "main.ts"],
  ["features/remote-push/remote-push.css", "main.ts"],
  ["features/remote-push/remote-authentication.css", "main.ts"],
  ["features/remote-push/remote-management.css", "main.ts"],
  ["features/git-operations/git-operation-controls.css", "main.ts"],
  ["features/git-operations/conflict-editor.css", "main.ts"],
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

test("project folders use the same configured UI scale as files", async () => {
  const source = await readFile(
    new URL("../src/features/files-editor/project-files.css", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /\.project-directory > summary,\s*\.project-directory-row\s*\{[^}]*font-size:\s*var\(--ui-font-size, 13px\);/s,
  );
});

test("Push mode remains one aligned split action with a visible native-scale chevron", async () => {
  const source = await readFile(
    new URL("../src/features/remote-push/remote-push.css", import.meta.url),
    "utf8",
  );
  assert.match(source, /\.push-split-action\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*stretch;/s);
  assert.match(source, /\.push-mode-chevron\s*\{[^}]*border-right:\s*1\.5px solid currentColor;[^}]*transform:\s*rotate\(45deg\);/s);
  // The shared primary-button surface is evaluated after the feature stylesheets, so the split
  // declarations must outrank it by scope instead of relying on source order.
  assert.match(source, /\.push-split-action \.push-primary-action\s*\{[^}]*border-right:\s*0;[^}]*border-radius:\s*5px 0 0 5px;/s);
  assert.match(source, /\.push-split-action \.push-mode-toggle\s*\{[^}]*padding:\s*0;[^}]*border-radius:\s*0 5px 5px 0;/s);
  assert.match(source, /\.push-split-action \.push-mode-chevron\s*\{/u);
});

test("both project search fields keep one query field with flat in-field option segments", async () => {
  const [shell, search, history] = await Promise.all([
    readFile(new URL("../src/shell/shell.css", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/workspace-search.css", import.meta.url), "utf8"),
    readFile(new URL("../src/features/git-history/history.css", import.meta.url), "utf8"),
  ]);
  // The command surface matches the Git History search control: a neutral border that only lights up
  // while the field owns focus, and contiguous segments separated by 1px dividers.
  assert.match(shell, /\.command-surface-input\s*\{[^}]*border:\s*1px solid var\(--border-strong\);/s);
  assert.doesNotMatch(shell, /\.command-surface-input\s*\{[^}]*box-shadow/s);
  assert.match(shell, /\.command-surface-input:focus-within\s*\{[^}]*border-color:\s*var\(--focus-ring\);[^}]*box-shadow:\s*0 0 0 1px var\(--focus-ring\);/s);
  assert.match(shell, /\.command-surface-input textarea\s*\{/u);
  assert.doesNotMatch(shell, /\.command-surface-input input\s*\{/u);
  assert.match(search, /\.command-surface-input \.search-option-strip\s*\{[^}]*gap:\s*0;/s);
  assert.match(search, /\.workspace-search-mode\s*\{[^}]*border-left:\s*1px solid var\(--border\);[^}]*border-radius:\s*0;/s);
  assert.match(history, /\.history-mode-button\s*\{[^}]*border-left:\s*1px solid var\(--border\);[^}]*border-radius:\s*0;/s);
});

test("merged Diff restates its collapsed rows and centres the revert control on the change", async () => {
  const [theme, diff, editor] = await Promise.all([
    readFile(new URL("../src/editor-theme.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/editable-diff.css", import.meta.url), "utf8"),
    readFile(new URL("../src/editable-diff-editor.ts", import.meta.url), "utf8"),
  ]);
  // CodeMirror renders collapsed unchanged rows as a real widget, so the app theme owns its color.
  assert.match(theme, /"\.cm-collapsedLines":\s*\{[^}]*color:\s*"var\(--info-text\)",[^}]*background:\s*"linear-gradient/s);
  assert.match(diff, /\.cm-merge-revert\s*\{[^}]*width:\s*32px;[^}]*flex:\s*0 0 32px;/s);
  assert.match(diff, /\.editable-diff-revert\s*\{[^}]*width:\s*26px;[^}]*height:\s*26px;[^}]*margin-top:\s*7px;[^}]*transform:\s*translateX\(-50%\);/s);
  // The panes own separate horizontal scrollers, so the editable Diff links only that axis.
  assert.match(editor, /linkHorizontalScroll\(\s*this\.mergeView\.a\.scrollDOM,\s*this\.mergeView\.b\.scrollDOM,\s*\)/s);
});

test("dialog buttons share one surface, follow the UI font size, and define danger centrally", async () => {
  const layout = await readFile(new URL("../src/shared/layout.css", import.meta.url), "utf8");
  const owned = await Promise.all(
    ownedStyles
      .filter(([stylePath]) => stylePath !== "shared/layout.css")
      .map(([stylePath]) => readFile(new URL(`../src/${stylePath}`, import.meta.url), "utf8")),
  );
  assert.match(layout, /\.primary-button,\s*\.secondary-button,\s*\.danger-button\s*\{[^}]*height:\s*31px;[^}]*font-size:\s*max\(10px,\s*calc\(var\(--ui-font-size, 13px\) - 2px\)\);/s);
  assert.match(layout, /\.danger-button\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--red\) 12%, var\(--bg-panel\)\);[^}]*color:\s*var\(--danger-text\);/s);
  assert.match(layout, /\.danger-button:hover:not\(:disabled\)\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--red\) 20%, var\(--bg-panel\)\);/s);
  // A dialog must never have to scope its own destructive variant to get a styled confirm button.
  const scoped = owned.filter((source) => /\.danger-button\s*\{/u.test(source));
  assert.equal(scoped.length, 0, "the destructive surface belongs to the shared button layer only");
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
