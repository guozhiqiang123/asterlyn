import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWindowChromeMode,
  primaryShortcut,
  showCustomWindowControls,
  windowChromeClass,
} from "../src/workbench/window-chrome.ts";

test("native macOS chrome keeps system controls and hides custom controls", () => {
  const mode = parseWindowChromeMode("macos-native");
  assert.equal(windowChromeClass(mode), "platform-macos-native");
  assert.equal(showCustomWindowControls(mode, true), false);
});

test("Windows and Linux native windows keep right-side custom controls", () => {
  const mode = parseWindowChromeMode("custom-right");
  assert.equal(windowChromeClass(mode), "platform-custom-chrome");
  assert.equal(showCustomWindowControls(mode, true), true);
});

test("browser and unknown modes fail closed to the custom layout without controls", () => {
  const mode = parseWindowChromeMode("future-mode");
  assert.equal(mode, "custom-right");
  assert.equal(showCustomWindowControls(mode, false), false);
});

test("primary shortcut labels follow the native platform convention", () => {
  assert.deepEqual(primaryShortcut("macos-native", "p"), {
    label: "⌘P",
    accessible: "Command+P",
  });
  assert.deepEqual(primaryShortcut("macos-native", "f", true), {
    label: "⌘⇧F",
    accessible: "Command+Shift+F",
  });
  assert.deepEqual(primaryShortcut("custom-right", "p"), {
    label: "Ctrl+P",
    accessible: "Ctrl+P",
  });
});
