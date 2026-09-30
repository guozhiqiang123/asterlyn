import test from "node:test";
import assert from "node:assert/strict";

import { WORKBENCH_COMMANDS } from "../src/application/commands/workbench-command-ids.ts";
import {
  refreshCommandCenterShortcut,
  refreshCommandShortcut,
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
