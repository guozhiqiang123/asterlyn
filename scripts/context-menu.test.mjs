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
import {
  GIT_BLAME_TOGGLE_ACTION,
  gitBlameContextSession,
} from "../src/features/files-editor/editor-gutter-context-actions.ts";
import { EN_US } from "../src/localization/en-US.ts";

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
});

test("menu navigation skips separators, wraps, and supports edge and type-ahead focus", () => {
  const items = [
    { kind: "command", id: "blocked", actionId: "blocked", label: "Blocked", availability: blocked },
    { kind: "separator" },
    { kind: "command", id: "copy", actionId: "copy", label: "Copy path", availability: enabled },
    { kind: "command", id: "delete", actionId: "delete", label: "Delete", availability: enabled },
  ];
  assert.equal(initialContextMenuIndex(items), 2);
  assert.equal(moveContextMenuIndex(items, 0, 1), 2);
  assert.equal(moveContextMenuIndex(items, 0, -1), 3);
  assert.equal(contextMenuEdgeIndex(items, "first"), 0);
  assert.equal(contextMenuEdgeIndex(items, "last"), 3);
  assert.equal(contextMenuTypeaheadIndex(items, 2, "d"), 3);
  assert.equal(contextMenuTypeaheadIndex(items, 3, "c"), 2);
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

test("Git Blame provider retains checked, busy, blocked, and current-target behavior", async () => {
  let current = true;
  let toggles = 0;
  let blockedReason = "";
  let restores = 0;
  const state = {
    active: true,
    loading: false,
    enabled: true,
    unavailableReason: null,
    copy: EN_US.editor,
    isCurrent: () => current,
    toggle: () => { toggles += 1; },
    blocked: (reason) => { blockedReason = reason; },
    restoreFocus: () => { restores += 1; },
  };
  const session = gitBlameContextSession("editor.test", state);
  assert.equal(session.ownerId, "editor.test");
  assert.deepEqual(session.model.items[0], {
    kind: "check",
    id: GIT_BLAME_TOGGLE_ACTION,
    actionId: GIT_BLAME_TOGGLE_ACTION,
    label: EN_US.editor.hideGitBlame,
    checked: true,
    availability: enabled,
  });
  await session.invoke(GIT_BLAME_TOGGLE_ACTION);
  assert.equal(toggles, 1);
  current = false;
  await session.invoke(GIT_BLAME_TOGGLE_ACTION);
  assert.equal(toggles, 1);
  session.blocked("Wait");
  session.restoreFocus();
  assert.equal(blockedReason, "Wait");
  assert.equal(restores, 1);

  const busySession = gitBlameContextSession("editor.test", {
    ...state,
    active: false,
    loading: true,
  });
  assert.deepEqual(busySession.model.items[0]?.availability, {
    kind: "busy",
    label: EN_US.editor.loadingGitBlame,
  });
  const blockedSession = gitBlameContextSession("editor.test", {
    ...state,
    active: false,
    loading: false,
    enabled: false,
    unavailableReason: EN_US.editor.gitBlameRequiresSavedFile,
  });
  assert.deepEqual(blockedSession.model.items[0]?.availability, {
    kind: "blocked",
    reason: EN_US.editor.gitBlameRequiresSavedFile,
  });
});

test("CodeMirror adapters delegate menu lifecycle to the lazy per-window host", async () => {
  const [gutter, host, lazyHost, app] = await Promise.all([
    readFile(new URL("../src/features/files-editor/editor-gutter.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/context-menu/context-menu-host.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/context-menu/lazy-context-menu-host.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(gutter, /activeMenu|document\.body|addEventListener/u);
  assert.match(gutter, /openMenu\(event, view\)/u);
  assert.match(host, /class ContextMenuHost implements ContextMenuPort/u);
  assert.match(host, /AbortController/u);
  assert.match(host, /active\.session\.dismissed\?\.\(\)/u);
  assert.match(host, /revalidate\(\): void/u);
  assert.match(host, /!active\.session\.isCurrent\(\)/u);
  assert.match(lazyHost, /import\("\.\/context-menu-host\.ts"\)/u);
  assert.match(lazyHost, /pending\?\.session\.dismissed\?\.\(\)/u);
  assert.match(lazyHost, /addEventListener\("contextmenu", this\.preventNativeContextMenu/u);
  assert.match(lazyHost, /this\.listeners\.abort\(\)/u);
  assert.match(app, /new LazyContextMenuHost\(document, window\)/u);
  assert.match(app, /this\.contextMenuHost\.dispose\(\)/u);
});
