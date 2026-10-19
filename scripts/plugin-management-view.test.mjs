import assert from "node:assert/strict";
import test from "node:test";

import {
  nextPluginManagementTab,
  renderPluginManagementSection,
} from "../src/features/settings/plugin-management-view.ts";

const copy = {
  locale: "en-US",
  title: "Plugins", description: "Manage integrations.", builtIn: "Built-in", enablePlugin: "Enable plugin", enabled: "Enabled", disabled: "Disabled",
  matched: "Detected", notMatched: "Not detected", active: "Active", inactive: "Inactive", version: "Version",
  diagnostics: "Diagnostic", settings: "Plugin settings", noSettings: "No settings.", noPlugins: "No plugins.", loadingPlugins: "Loading plugins…", invalidSetting: "Unavailable.",
  installedTab: "Installed", marketplaceTab: "Marketplace", marketplaceDescription: "Discover plugins.", addSource: "Add source", editSource: "Edit source", deleteSource: "Remove source", confirmDeleteSource: "Remove this source?", cancel: "Cancel", save: "Save",
  repository: "GitHub repository", sourceName: "Display name", sourceDescription: "Description", sourceRepositoryPlaceholder: "owner/repository", sourceNamePlaceholder: "Plugin name", sourceDescriptionPlaceholder: "Description",
  officialSource: "Official source", customSource: "Custom source", enableSource: "Enable source", refreshSource: "Check Release", refreshingSource: "Checking…", loadingMarketplace: "Loading sources…", noSources: "No sources.", notChecked: "Not checked", releaseAvailable: "Release available", noRelease: "No stable Release", staleRelease: "cached", packageLabel: "Package: ", checkedLabel: "Checked: ", marketplaceSecurityNote: "Packages are verified before installation.",
  inspectPackage: "Review package", inspectingPackage: "Inspecting…", confirmAdmission: "Admit package", admissionTitle: "Review plugin package", permissions: "Permissions", capabilities: "Capabilities", license: "License", pendingRuntimeNote: "Pending isolated runtime.",
  admittedPackage: "Admitted package", pendingRuntime: "Pending isolated runtime", pendingRestart: "Restart required", restartToApply: "Restart Asterlyn", restarting: "Restarting…",
  enableInstalledPlugin: "Enable installed package", knownGood: "Known good", quarantined: "Quarantined", rollback: "Roll back", uninstallPlugin: "Uninstall", confirmUninstallPlugin: "Uninstall this plugin package?", uninstallKeepsData: "Plugin data is retained.",
};

const entry = {
  id: "dev.asterlyn.android-gradle", version: "0.1.0", origin: "bundled", nameKey: "name",
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
  assert.match(html, /class="select-control"/u);
  assert.match(html, /data-plugin-workspace-trust="workspaceTrust"/u);
  assert.match(html, /role="switch"[^>]*checked/u);
  assert.match(html, /class="plugin-setting-switch-track" aria-hidden="true"/u);
  assert.match(html, /Trust this workspace/u);
  assert.match(html, /role="tablist"/u);
  assert.match(html, /role="tabpanel" aria-labelledby="plugin-management-tab-installed"/u);
  assert.match(html, /data-plugin-management-tab="installed"[^>]*tabindex="0"/u);
  assert.match(html, /data-plugin-management-tab="marketplace"[^>]*tabindex="-1"/u);
  assert.doesNotMatch(html, /<script|\son[a-z]+\s*=|<iframe/i);
});

test("installed manifest settings do not render a second conflicting enable switch", () => {
  const html = renderPluginManagementSection(
    { schemaVersion: 1, entries: [{ ...entry, origin: "installed" }] },
    copy,
  );
  assert.match(html, /Admitted package/u);
  assert.match(html, /data-plugin-setting="taskPresentation"/u);
  assert.doesNotMatch(html, /id="plugin-enabled-dev\.asterlyn\.android-gradle"/u);
});

test("plugin management tabs support the standard two-tab keyboard model", () => {
  assert.equal(nextPluginManagementTab("installed", "ArrowRight"), "marketplace");
  assert.equal(nextPluginManagementTab("marketplace", "ArrowLeft"), "installed");
  assert.equal(nextPluginManagementTab("marketplace", "Home"), "installed");
  assert.equal(nextPluginManagementTab("installed", "End"), "marketplace");
  assert.equal(nextPluginManagementTab("installed", "Enter"), null);
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

test("plugin marketplace renders configured Release sources as host-owned controls", () => {
  const html = renderPluginManagementSection(
    { schemaVersion: 1, entries: [entry] },
    copy,
    false,
    {
      tab: "marketplace", loading: false, error: null, busyRepository: null, form: null,
      confirmDeleteRepository: null,
      admissionReview: null,
      installations: null,
      snapshot: { schemaVersion: 1, generation: 2, recovered: false, sources: [{
        repository: "asterlyn/example", name: "Example", description: "Example tools", builtIn: false, enabled: true,
        catalog: { status: "available", checkedAtEpochMs: 1, stale: false, version: "1.2.3", releaseUrl: "https://github.com/asterlyn/example/releases/tag/v1.2.3", assetName: "example.asterlyn-plugin.tgz", assetDownloadUrl: "https://github.com/asterlyn/example/releases/download/v1.2.3/example.asterlyn-plugin.tgz", assetSizeBytes: 1234, digest: `sha256:${"a".repeat(64)}`, error: null, rateLimitResetEpochMs: null, etag: null, lastModified: null },
      }] },
    },
  );
  assert.match(html, /data-plugin-marketplace/u);
  assert.match(html, /data-plugin-source="asterlyn\/example"/u);
  assert.match(html, /Release available: v1\.2\.3/u);
  assert.match(html, /data-plugin-source-refresh="asterlyn\/example"/u);
  assert.match(html, /data-plugin-source-install="asterlyn\/example"/u);
  assert.match(html, /data-plugin-source-delete="asterlyn\/example"/u);
  assert.doesNotMatch(html, /<script|\son[a-z]+\s*=/iu);
});

test("plugin marketplace renders a host-owned admission review", () => {
  const html = renderPluginManagementSection({ schemaVersion: 1, entries: [] }, copy, false, {
    tab: "marketplace", loading: false, error: null, busyRepository: null, form: null,
    confirmDeleteRepository: null, installations: null, snapshot: { schemaVersion: 1, generation: 2, recovered: false, sources: [] },
    admissionReview: { reviewToken: "b".repeat(64), repository: "asterlyn/example", sourceGeneration: 2, assetName: "example.asterlyn-plugin.tgz", assetSizeBytes: 1024, digest: `sha256:${"a".repeat(64)}`, pluginId: "dev.asterlyn.example", version: "1.2.3", licenseExpression: "MIT", capabilities: ["tasks"], permissions: ["host.tasks.execute"], expandedBytes: 2048 },
  });
  assert.match(html, /Review plugin package/u);
  assert.match(html, /host\.tasks\.execute/u);
  assert.match(html, /data-plugin-admission-confirm/u);
  assert.match(html, /Pending isolated runtime/u);
});

test("installed plugins require a controlled restart before activation", () => {
  const html = renderPluginManagementSection({ schemaVersion: 1, entries: [] }, copy, false, {
    tab: "installed", loading: false, error: null, busyRepository: null, form: null,
    confirmDeleteRepository: null, admissionReview: null, snapshot: null, restarting: false,
    restartRequired: false, busyPlugin: null, confirmUninstallPlugin: null,
    installations: { schemaVersion: 1, generation: 3, recovered: false, plugins: [{
      pluginId: "dev.asterlyn.example", repository: "asterlyn/example", enabled: true,
      bundledFallback: false, activeVersion: null, knownGoodVersion: null, pendingVersion: "1.2.3",
      versions: [{ version: "1.2.3", packageDigest: `sha256:${"a".repeat(64)}`, admittedAtEpochMs: 42, runtimeStatus: "pendingRestart" }],
    }] },
  });
  assert.match(html, /data-plugin-restart/u);
  assert.match(html, /Restart required/u);
  assert.match(html, /Restart Asterlyn/u);
  assert.match(html, /data-installed-plugin-enabled/u);
  assert.match(html, /data-installed-plugin-uninstall/u);
});

test("installed plugin history exposes exact rollback and explicit retained-data uninstall review", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const html = renderPluginManagementSection({ schemaVersion: 1, entries: [] }, copy, false, {
    tab: "installed", loading: false, error: null, busyRepository: null, form: null,
    confirmDeleteRepository: null, admissionReview: null, snapshot: null, restarting: false,
    restartRequired: false, busyPlugin: null, confirmUninstallPlugin: "dev.asterlyn.example",
    installations: { schemaVersion: 1, generation: 4, recovered: false, plugins: [{
      pluginId: "dev.asterlyn.example", repository: "asterlyn/example", enabled: true,
      bundledFallback: false, activeVersion: "2.0.0", knownGoodVersion: "2.0.0", pendingVersion: null,
      versions: [
        { version: "1.0.0", packageDigest: digest, admittedAtEpochMs: 1, runtimeStatus: "knownGood" },
        { version: "2.0.0", packageDigest: `sha256:${"b".repeat(64)}`, admittedAtEpochMs: 2, runtimeStatus: "knownGood" },
      ],
    }] },
  });
  assert.match(html, /data-installed-plugin-rollback="dev\.asterlyn\.example"/u);
  assert.match(html, /data-package-digest="sha256:a{64}"/u);
  assert.match(html, /data-installed-plugin-uninstall-confirm/u);
  assert.match(html, /Plugin data is retained/u);
});
