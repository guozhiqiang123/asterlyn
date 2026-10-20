import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  contextMenuModelErrors,
} from "../src/shared/context-menu/context-menu-model.ts";
import {
  contextMenuEdgeIndex,
  contextMenuTypeaheadIndex,
  initialContextMenuIndex,
  moveContextMenuIndex,
} from "../src/shared/context-menu/context-menu-navigation.ts";
import {
  placeContextMenu,
  placeContextSubmenu,
} from "../src/shared/context-menu/context-menu-position.ts";

const enabled = { kind: "enabled" };
const blocked = { kind: "blocked", reason: "Not available" };

test("context menu models enforce stable ids, reasons, separators, and one submenu level", () => {
  assert.deepEqual(contextMenuModelErrors({
    ariaLabel: "Actions",
    items: [
      { kind: "command", id: "open", actionId: "files.open", label: "Open", availability: enabled },
      { kind: "separator" },
      {
        kind: "submenu",
        id: "copy",
        label: "Copy",
        availability: enabled,
        children: [{
          kind: "command",
          id: "copy.path",
          actionId: "files.copy-path",
          label: "Path",
          secondaryText: "/work/project/src/app.ts",
          availability: enabled,
        }],
      },
    ],
  }), []);

  const errors = contextMenuModelErrors({
    ariaLabel: "",
    items: [
      { kind: "separator" },
      { kind: "command", id: "same", actionId: "", label: "", availability: blocked },
      {
        kind: "submenu",
        id: "same",
        label: "Nested",
        availability: enabled,
        children: [{
          kind: "command",
          id: "child",
          actionId: "child",
          label: "Child",
          availability: { kind: "blocked", reason: "" },
        }],
      },
    ],
  });
  assert.ok(errors.some((error) => error.includes("ariaLabel")));
  assert.ok(errors.some((error) => error.includes("leading or trailing separator")));
  assert.ok(errors.some((error) => error.includes("duplicate item id same")));
  assert.ok(errors.some((error) => error.includes("no actionId")));
  assert.ok(errors.some((error) => error.includes("empty blocked reason")));

  const secondaryTextErrors = contextMenuModelErrors({
    ariaLabel: "Actions",
    items: [{
      kind: "command",
      id: "copy",
      actionId: "copy",
      label: "Copy",
      secondaryText: " ",
      availability: enabled,
    }],
  });
  assert.ok(secondaryTextErrors.some((error) => error.includes("empty secondary text")));
});

test("menu navigation skips separators, wraps, and supports edge and type-ahead focus", () => {
  const items = [
      { kind: "command", id: "blocked", actionId: "blocked", label: "Blocked", availability: blocked },
      { kind: "separator" },
      { kind: "heading", label: "Files" },
      { kind: "command", id: "copy", actionId: "copy", label: "Copy path", availability: enabled },
      { kind: "command", id: "delete", actionId: "delete", label: "Delete", availability: enabled },
    ];
  assert.equal(initialContextMenuIndex(items), 3);
  assert.equal(moveContextMenuIndex(items, 0, 1), 3);
  assert.equal(moveContextMenuIndex(items, 0, -1), 4);
  assert.equal(contextMenuEdgeIndex(items, "first"), 0);
  assert.equal(contextMenuEdgeIndex(items, "last"), 4);
  assert.equal(contextMenuTypeaheadIndex(items, 3, "d"), 4);
  assert.equal(contextMenuTypeaheadIndex(items, 4, "c"), 3);
});

test("root and submenu placement stays inside the viewport and flips at the right edge", () => {
  assert.deepEqual(
    placeContextMenu({ x: 98, y: -10 }, { width: 30, height: 20 }, { width: 100, height: 80 }),
    { x: 66, y: 4, opensLeft: false },
  );
  assert.deepEqual(
    placeContextSubmenu(
      { x: 70, y: 50, width: 25, height: 20 },
      { width: 40, height: 40 },
      { width: 100, height: 80 },
    ),
    { x: 32, y: 36, opensLeft: true },
  );
});

test("CodeMirror adapters delegate menu lifecycle to the lazy per-window host", async () => {
  const [gutter, host, lazyHost, app] = await Promise.all([
    readFile(new URL("../src/features/files-editor/editor-gutter.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/context-menu/context-menu-host.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/context-menu/lazy-context-menu-host.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(gutter, /activeMenu|document\.body/u);
  assert.match(gutter, /contextmenu|openMenu/u);
  assert.match(host, /class ContextMenuHost implements ContextMenuPort/u);
  assert.match(host, /AbortController/u);
  assert.match(host, /active\.session\.dismissed\?\.\(\)/u);
  assert.match(host, /revalidate\(\): void/u);
  assert.match(host, /!active\.session\.isCurrent\(\)/u);
  assert.match(host, /addEventListener\("wheel"/u);
  assert.match(host, /addEventListener\("touchmove"/u);
  assert.doesNotMatch(host, /addEventListener\("scroll"/u);
  assert.match(host, /secondary\.textContent = item\.secondaryText/u);
  assert.match(host, /secondary\.title = item\.secondaryText/u);
  assert.match(lazyHost, /import\("\.\/context-menu-host\.ts"\)/u);
  assert.match(lazyHost, /pending\?\.session\.dismissed\?\.\(\)/u);
  assert.match(lazyHost, /addEventListener\("contextmenu", this\.preventNativeContextMenu/u);
  assert.match(lazyHost, /this\.listeners\.abort\(\)/u);
  assert.match(app, /new LazyContextMenuHost\(document, window\)/u);
  assert.match(app, /this\.contextMenuHost\.dispose\(\)/u);
});

test("context-menu secondary text wraps in full instead of being clipped", async () => {
  const css = await readFile(
    new URL("../src/shared/context-menu/context-menu.css", import.meta.url),
    "utf8",
  );
  const rule = css.match(/\.context-menu-secondary-text\s*\{[^}]*\}/su)?.[0];
  assert.ok(rule);
  assert.match(rule, /overflow-wrap:\s*anywhere/u);
  assert.match(rule, /white-space:\s*pre-wrap/u);
  assert.doesNotMatch(rule, /max-height|overflow:\s*hidden|text-overflow/u);
});
