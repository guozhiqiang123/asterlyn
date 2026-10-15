import assert from "node:assert/strict";
import test from "node:test";

import { renderPluginManagementSection } from "../src/features/settings/plugin-management-view.ts";

const copy = {
  locale: "en-US",
  title: "Plugins", description: "Manage integrations.", builtIn: "Built-in", enablePlugin: "Enable plugin", enabled: "Enabled", disabled: "Disabled",
  matched: "Detected", notMatched: "Not detected", active: "Active", inactive: "Inactive", version: "Version",
  diagnostics: "Diagnostic", settings: "Plugin settings", noSettings: "No settings.", noPlugins: "No plugins.", loadingPlugins: "Loading plugins…", invalidSetting: "Unavailable.",
};

const entry = {
  id: "dev.asterlyn.android-gradle", version: "0.1.0", nameKey: "name",
  descriptionKey: "description", enabled: true, matched: false, active: false,
  localization: { defaultLocale: "en-US", locales: {
    "en-US": { name: "Android / Gradle", description: "Gradle tooling.", "settings.taskPresentation.label": "Task presentation", "settings.taskPresentation.description": "Choose the task tree.", "settings.taskPresentation.allTasksTree": "All tasks tree", "settings.taskPresentation.quickActionsTree": "Quick actions tree", "authorization.workspaceTrust.label": "Trust this workspace", "authorization.workspaceTrust.description": "Allow this plugin to run reviewed Gradle tasks." },
    "zh-CN": { name: "Android / Gradle", description: "Gradle 工具。", "settings.taskPresentation.label": "任务展示方式", "settings.taskPresentation.description": "选择任务树。", "settings.taskPresentation.allTasksTree": "完整任务树", "settings.taskPresentation.quickActionsTree": "快捷操作树", "authorization.workspaceTrust.label": "信任此工作区", "authorization.workspaceTrust.description": "允许插件运行已审查的 Gradle 任务。" },
  } },
  taskAuthorization: {
    workspaceTrust: { id: "workspaceTrust", labelKey: "authorization.workspaceTrust.label", descriptionKey: "authorization.workspaceTrust.description" },
    taskConfirmation: { rememberLabelKey: "authorization.rememberTask.label" },
  },
  workspaceTrust: "trusted",
  settingDescriptors: [{ id: "taskPresentation", kind: "enum", labelKey: "settings.taskPresentation.label", descriptionKey: "settings.taskPresentation.description", defaultValue: "all-tasks-tree", options: [
    { value: "all-tasks-tree", labelKey: "settings.taskPresentation.allTasksTree" },
    { value: "quick-actions-tree", labelKey: "settings.taskPresentation.quickActionsTree" },
  ] }], settings: { taskPresentation: "quick-actions-tree" }, diagnostics: [],
};

test("plugin management renders localized metadata and declarative settings without plugin HTML", () => {
  const html = renderPluginManagementSection({ schemaVersion: 1, entries: [entry] }, copy);
  assert.match(html, /data-plugin-id="dev\.asterlyn\.android-gradle"/);
  assert.match(html, /Android \/ Gradle/);
  assert.match(html, /data-plugin-setting="enabled"/);
  assert.match(html, /data-plugin-setting="taskPresentation"/);
  assert.match(html, /value="quick-actions-tree" selected/);
  assert.match(html, /data-plugin-workspace-trust="workspaceTrust"/u);
  assert.match(html, /role="switch"[^>]*checked/u);
  assert.match(html, /Trust this workspace/u);
  assert.doesNotMatch(html, /<script|on[a-z]+=|<iframe/i);
});

test("workspace trust switch fails closed while host authorization state is unavailable", () => {
  const html = renderPluginManagementSection(
    { schemaVersion: 1, entries: [{ ...entry, workspaceTrust: "error" }] },
    copy,
  );
  assert.match(html, /data-plugin-workspace-trust="workspaceTrust"[^>]*disabled/u);
  assert.doesNotMatch(html, /data-plugin-workspace-trust="workspaceTrust"[^>]*checked/u);
});

test("plugin management resolves plugin-owned Chinese copy and escapes it as text", () => {
  const html = renderPluginManagementSection(
    { schemaVersion: 1, entries: [{ ...entry, localization: { ...entry.localization, locales: { ...entry.localization.locales, "zh-CN": { ...entry.localization.locales["zh-CN"], description: "<script>不是标记</script>" } } } }] },
    { ...copy, locale: "zh-CN" },
  );
  assert.match(html, /任务展示方式/u);
  assert.match(html, /&lt;script&gt;不是标记&lt;\/script&gt;/u);
  assert.doesNotMatch(html, /<script>/u);
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
