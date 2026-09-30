import test from "node:test";
import assert from "node:assert/strict";
import { renderKeybindingSettings } from "../src/features/keybindings/keybinding-view.ts";
import { KEYBINDING_EN_US } from "../src/localization/keybinding-en-US.ts";

function model(overrides = {}) {
  return {
    query: "",
    filter: "all",
    category: "all",
    rows: [],
    modifiedCount: 0,
    recording: null,
    diagnostic: null,
    ...overrides,
  };
}

test("invalid profiles retain an enabled reset path", () => {
  const markup = renderKeybindingSettings(model({ diagnostic: "invalid" }), "macos", KEYBINDING_EN_US);
  const button = markup.match(/<button class="setting-retry-button"[^>]*data-keybinding-reset-all[^>]*>/)?.[0];
  assert.ok(button);
  assert.doesNotMatch(button, /disabled/);
  assert.match(markup, /saved shortcut profile is invalid/i);
});

test("conflicting and unavailable commands are visible in the settings row", () => {
  const markup = renderKeybindingSettings(model({
    rows: [{
      id: "test.command",
      title: "Test command",
      detail: "Test detail",
      keywords: "test",
      category: "workbench",
      enabled: false,
      reason: "Open a project first.",
      modified: true,
      unknown: false,
      bindings: [],
      conflicts: [{ ruleId: "other", commandId: "other.command", kind: "exact" }],
    }],
  }), "windows", KEYBINDING_EN_US);
  assert.match(markup, />Unavailable</);
  assert.match(markup, />Conflict</);
  assert.match(markup, /other\.command/);
});
