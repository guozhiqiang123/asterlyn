import assert from "node:assert/strict";
import test from "node:test";

import { renderPluginManagementSection } from "../src/features/settings/plugin-management-view.ts";

const copy = {
  title: "Plugins", description: "Manage integrations.", builtIn: "Built-in", enablePlugin: "Enable plugin", enabled: "Enabled", disabled: "Disabled",
  matched: "Detected", notMatched: "Not detected", active: "Active", inactive: "Inactive", version: "Version",
  diagnostics: "Diagnostic", settings: "Plugin settings", noSettings: "No settings.", noPlugins: "No plugins.", loadingPlugins: "Loading plugins…", invalidSetting: "Unavailable.",
  resolve: (key) => ({
    "plugins.androidGradle.name": "Android / Gradle",
    "plugins.androidGradle.description": "Gradle tooling.",
    "plugins.androidGradle.taskPresentation.label": "Task presentation",
    "plugins.androidGradle.taskPresentation.description": "Choose the task tree.",
    "plugins.androidGradle.taskPresentation.allTasksTree": "All tasks tree",
    "plugins.androidGradle.taskPresentation.quickActionsTree": "Quick actions tree",
  }[key] ?? key),
};

const entry = {
  id: "dev.asterlyn.android-gradle", version: "0.1.0", nameKey: "plugins.androidGradle.name",
  descriptionKey: "plugins.androidGradle.description", enabled: true, matched: false, active: false,
  settingDescriptors: [{ id: "taskPresentation", kind: "enum", labelKey: "plugins.androidGradle.taskPresentation.label", descriptionKey: "plugins.androidGradle.taskPresentation.description", defaultValue: "all-tasks-tree", options: [
    { value: "all-tasks-tree", labelKey: "plugins.androidGradle.taskPresentation.allTasksTree" },
    { value: "quick-actions-tree", labelKey: "plugins.androidGradle.taskPresentation.quickActionsTree" },
  ] }], settings: { taskPresentation: "quick-actions-tree" }, diagnostics: [],
};

test("plugin management renders localized metadata and declarative settings without plugin HTML", () => {
  const html = renderPluginManagementSection({ schemaVersion: 1, entries: [entry] }, copy);
  assert.match(html, /data-plugin-id="dev\.asterlyn\.android-gradle"/);
  assert.match(html, /Android \/ Gradle/);
  assert.match(html, /data-plugin-setting="enabled"/);
  assert.match(html, /data-plugin-setting="taskPresentation"/);
  assert.match(html, /value="quick-actions-tree" selected/);
  assert.doesNotMatch(html, /<script|on[a-z]+=|<iframe/i);
});

test("plugin management exposes bounded diagnostic and non-color status text", () => {
  const html = renderPluginManagementSection({ schemaVersion: 1, entries: [{ ...entry, enabled: false, matched: true, active: true, diagnostics: Array.from({ length: 5 }, (_, index) => ({ kind: "activation-failed", pluginId: entry.id, message: index === 0 ? "Activation failed safely." : "x".repeat(600) })) }] }, copy);
  assert.match(html, /Activation failed safely\./);
  assert.match(html, /Disabled/);
  assert.match(html, /Detected/);
  assert.match(html, /Active/);
  assert.match(html, /role="alert"/);
  assert.equal((html.match(/<li>/g) ?? []).length, 4);
  assert.ok(!html.includes("x".repeat(600)));
});

test("plugin management renders an empty catalog without a workspace", () => {
  const html = renderPluginManagementSection({ schemaVersion: 1, entries: [] }, copy);
  assert.match(html, /No plugins\./);
  assert.match(html, /data-plugin-management/);
});
