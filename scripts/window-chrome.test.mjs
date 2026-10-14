import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWindowChromeMode,
  showCustomWindowControls,
  windowChromeClass,
} from "../src/shell/window-chrome.ts";
import {
  approveProjectWindowClose,
  interceptNativeCloseRequest,
} from "../src/application/window-close-gate.ts";

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

test("the final project window requires confirmation before unsaved-file handling", async () => {
  const events = [];
  const cancelled = await approveProjectWindowClose({
    isLastProjectWindow: async () => { events.push("count"); return true; },
    confirmLastProjectWindow: async () => { events.push("confirm-last"); return false; },
    confirmUnsavedChanges: async () => { events.push("unsaved"); return true; },
  });
  assert.equal(cancelled, false);
  assert.deepEqual(events, ["count", "confirm-last"]);

  events.length = 0;
  const approved = await approveProjectWindowClose({
    isLastProjectWindow: async () => { events.push("count"); return true; },
    confirmLastProjectWindow: async () => { events.push("confirm-last"); return true; },
    confirmUnsavedChanges: async () => { events.push("unsaved"); return true; },
  });
  assert.equal(approved, true);
  assert.deepEqual(events, ["count", "confirm-last", "unsaved"]);
});

test("non-final project windows keep the existing unsaved-file gate without an exit prompt", async () => {
  let exitPrompts = 0;
  const approved = await approveProjectWindowClose({
    isLastProjectWindow: async () => false,
    confirmLastProjectWindow: async () => { exitPrompts += 1; return true; },
    confirmUnsavedChanges: async () => true,
  });
  assert.equal(approved, true);
  assert.equal(exitPrompts, 0);
});

test("native close requests are always intercepted for asynchronous close checks", () => {
  let prevented = 0;
  let requested = 0;
  interceptNativeCloseRequest(
    { preventDefault: () => { prevented += 1; } },
    () => { requested += 1; },
  );
  assert.equal(prevented, 1);
  assert.equal(requested, 1);
});
