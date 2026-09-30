import test from "node:test";
import assert from "node:assert/strict";

import { WORKBENCH_COMMANDS } from "../src/application/commands/workbench-command-ids.ts";
import {
  refreshCommandCenterShortcut,
  refreshCommandShortcut,
  shortcutFocusScope,
} from "../src/shell/shortcut-presentation.ts";

function element(children = {}) {
  const attributes = new Map();
  return {
    attributes,
    title: "",
    textContent: "",
    querySelector: (selector) => children[selector] ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: (name) => attributes.get(name) ?? null,
    removeAttribute: (name) => attributes.delete(name),
  };
}

test("customized shortcuts update persistent control titles and accessibility metadata", () => {
  const button = element();
  const root = { querySelector: (selector) => selector === "#settings-button" ? button : null };
  const keybindings = {
    accessibleShortcutForCommand: (id) => id === WORKBENCH_COMMANDS.openSettings
      ? "Command+,"
      : null,
  };

  refreshCommandShortcut(root, keybindings, {
    selector: "#settings-button",
    commandId: WORKBENCH_COMMANDS.openSettings,
    label: "Open Settings",
    title: "Settings",
    staticAriaShortcuts: ["Alt+ArrowUp"],
  });

  assert.equal(button.getAttribute("aria-label"), "Open Settings");
  assert.equal(button.title, "Settings (Command+,)");
  assert.equal(button.getAttribute("aria-keyshortcuts"), "Alt+ArrowUp Meta+,");
});

test("command center visible and accessible labels follow the effective binding", () => {
  const key = element();
  const button = element({ kbd: key });
  const root = { querySelector: (selector) => selector === "#command-center-button" ? button : null };
  const keybindings = {
    shortcutForCommand: () => "⌘K ⌘P",
    accessibleShortcutForCommand: () => "Command+K Command+P",
  };

  refreshCommandCenterShortcut(root, "Search files and commands", keybindings);

  assert.equal(key.textContent, "⌘K ⌘P");
  assert.equal(button.title, "Search files and commands (Command+K Command+P)");
  assert.equal(button.getAttribute("aria-keyshortcuts"), "Meta+K Meta+P");
});

test("focus routing keeps every shortcut surface mutually exclusive and protects text inputs", () => {
  class FakeElement {
    constructor(selectors = []) { this.selectors = new Set(selectors); }
    closest(selector) { return this.selectors.has(selector) ? this : null; }
  }
  class FakeInput extends FakeElement {}
  class FakeTextArea extends FakeElement {}
  class FakeSelect extends FakeElement {}
  const previous = {
    Element: globalThis.Element,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
    HTMLSelectElement: globalThis.HTMLSelectElement,
  };
  Object.assign(globalThis, {
    Element: FakeElement,
    HTMLInputElement: FakeInput,
    HTMLTextAreaElement: FakeTextArea,
    HTMLSelectElement: FakeSelect,
  });

  const scope = (target, leftTool = null, bottomTool = null, documentKind = "project-file") =>
    shortcutFocusScope(target, false, documentKind, leftTool, bottomTool);
  try {
    assert.equal(shortcutFocusScope(null, true, "empty", null, null), "settings");
    assert.equal(scope(null), "workbench");
    assert.equal(scope(new FakeElement(["#left-tool"]), "files"), "files");
    assert.equal(scope(new FakeElement(["#left-tool"]), "changes"), "changes");
    assert.equal(scope(new FakeElement(["#bottom-tool"]), null, "find"), "search");
    assert.equal(scope(new FakeElement(["#bottom-tool"]), null, "replace"), "search");
    assert.equal(scope(new FakeElement(["#bottom-tool"]), null, "stash"), "stash");
    assert.equal(scope(new FakeElement(["#bottom-tool"]), null, "branches"), "history");
    assert.equal(scope(new FakeInput(["#bottom-tool"]), null, "branches"), "history-input");
    assert.equal(scope(new FakeInput(["#left-tool"]), "changes"), "input");
    assert.equal(scope(new FakeElement([".cm-editor"])), "editor");
    assert.equal(scope(new FakeElement([".cm-editor"]), null, null, "diff"), "diff");
    assert.equal(
      scope(new FakeElement(["#push-diff-backdrop", "#remote-action-dialog", "[role='alertdialog'], [role='dialog']:not(.command-surface)"])),
      "diff",
    );
    assert.equal(scope(new FakeElement(["#remote-action-dialog"])), "remote");
    assert.equal(scope(new FakeInput(["#remote-action-dialog"])), "input");
    assert.equal(scope(new FakeElement(["#workspace-replacement-dialog"])), "replacement");
    assert.equal(scope(new FakeInput(["#workspace-replacement-dialog"])), "input");
    assert.equal(
      scope(new FakeElement(["[role='alertdialog'], [role='dialog']:not(.command-surface)"])),
      "dialog",
    );
    assert.equal(scope(new FakeElement([".xterm"])), "terminal");
  } finally {
    Object.assign(globalThis, previous);
  }
});
