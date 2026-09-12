import assert from "node:assert/strict";
import test from "node:test";

import { SettingsController } from "../src/features/settings/settings-controller.ts";
import { ShellController } from "../src/shell/shell-controller.ts";

test("settings owns bounded preferences and persists accepted updates", () => {
  const storage = memoryStorage();
  const controller = new SettingsController(storage);

  assert.equal(controller.update({ editorFontSize: 999 }), false);
  assert.notEqual(controller.state.preferences.editorFontSize, 999);
  assert.equal(controller.update({ editorFontSize: 16 }), true);
  assert.equal(new SettingsController(storage).state.preferences.editorFontSize, 16);
});

test("shell menus are mutually exclusive", () => {
  const controller = new ShellController(memoryStorage());
  controller.toggleRepositoryMenu();
  controller.toggleEditorTabMenu();

  assert.equal(controller.state.repositoryMenuOpen, false);
  assert.equal(controller.state.editorTabMenuOpen, true);
});

test("shell persists activity ordering and layout independently", () => {
  const storage = memoryStorage();
  const controller = new ShellController(storage);
  assert.equal(controller.moveActivityByOffset("changes", -1), true);
  controller.reduceLayout({ type: "resize", dimension: "leftWidth", value: 420 }, true);
  const restored = new ShellController(storage);

  assert.deepEqual(restored.state.activityOrder, controller.state.activityOrder);
  assert.equal(restored.state.layout.leftWidth, 420);
});

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, String(value)); },
  };
}
