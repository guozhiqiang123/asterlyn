import assert from "node:assert/strict";
import test from "node:test";

import { SettingsController, validateSettingsRoute } from "../src/features/settings/settings-controller.ts";

test("plugin settings routes retain and update deep-link targets", () => {
  const controller = new SettingsController(memoryStorage());
  const changes = [];
  controller.subscribe((change) => changes.push(change));

  controller.navigate({ section: "plugins", pluginId: "dev.asterlyn.android-gradle", focus: "taskPresentation" });
  assert.equal(controller.state.section, "plugins");
  assert.equal(controller.state.pluginId, "dev.asterlyn.android-gradle");
  assert.equal(controller.state.focus, "taskPresentation");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].routeChanged, true);

  controller.navigate({ section: "plugins", pluginId: "dev.asterlyn.android-gradle", focus: "other-setting" });
  assert.equal(changes.length, 2);
  assert.equal(changes[1].sectionChanged, false);
  assert.equal(changes[1].focusChanged, true);

  controller.navigate({ section: "plugins", pluginId: "dev.asterlyn.android-gradle", focus: "other-setting" });
  assert.equal(changes.length, 2);
  controller.dispose();
});

test("leaving plugin settings clears deep-link targets and selectSection remains compatible", () => {
  const controller = new SettingsController(memoryStorage());
  controller.selectPlugin("dev.asterlyn.android-gradle", "taskPresentation");
  controller.selectSection("general");
  assert.equal(controller.state.section, "general");
  assert.equal(controller.state.pluginId, undefined);
  assert.equal(controller.state.focus, undefined);
  controller.selectSection("plugins");
  assert.equal(controller.state.section, "plugins");
  assert.equal(controller.state.pluginId, undefined);
  assert.equal(controller.state.focus, undefined);
  controller.dispose();
});

test("settings routes reject invalid identifiers and arbitrary selectors", () => {
  assert.throws(() => validateSettingsRoute({ section: "plugins", pluginId: "#plugin" }), /Invalid settings plugin ID/);
  assert.throws(() => validateSettingsRoute({ section: "plugins", focus: "#focus" }), /Invalid settings focus/);
  assert.throws(() => validateSettingsRoute({ section: "plugins", focus: "https://example.com" }), /Invalid settings focus/);
  assert.throws(() => validateSettingsRoute({ section: "plugins", selector: "#task" }), /Invalid settings route target/);
  assert.throws(() => validateSettingsRoute({ section: "general", pluginId: "dev.plugin" }), /Plugin target/);
});

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}
