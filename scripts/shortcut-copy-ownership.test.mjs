import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("localized product copy does not own configurable shortcut combinations", async () => {
  for (const path of ["src/localization/en-US.ts", "src/localization/zh-CN.ts"]) {
    const source = await read(path);
    assert.doesNotMatch(
      source,
      /Ctrl\/Cmd|Ctrl\+|Command\+|Meta\+|Option\+|Alt\+|[⌘⌥⇧⌃]/u,
      `${path} must receive shortcut text from a formatter or the keybinding controller`,
    );
  }
});

test("configurable UI hints start empty and are owned by the shared projector", async () => {
  const [shell, history, commandSurface, projection] = await Promise.all([
    read("src/shell/shell-view.ts"),
    read("src/features/git-history/history-navigation-view.ts"),
    read("src/features/files-editor/workspace-navigation-view.ts"),
    read("src/shell/shortcut-presentation.ts"),
  ]);

  assert.match(shell, /<kbd data-command-shortcut hidden><\/kbd>/u);
  assert.doesNotMatch(shell, /primaryShortcut|Command\+P|⌘P/u);
  assert.doesNotMatch(history, /aria-keyshortcuts=/u);
  assert.match(commandSurface, /data-local-shortcut-help/u);
  assert.match(commandSurface, /data-command-shortcut hidden/u);
  for (const selector of [
    "#command-center-button",
    "#history-filter",
    "data-command-mode",
  ]) {
    assert.match(projection, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
});

test("context menus cannot bypass command shortcut ownership with raw labels", async () => {
  const [model, host] = await Promise.all([
    read("src/shared/context-menu/context-menu-model.ts"),
    read("src/shared/context-menu/context-menu-host.ts"),
  ]);

  assert.doesNotMatch(model, /readonly shortcut\??:/u);
  assert.doesNotMatch(host, /item\.shortcut/u);
});
