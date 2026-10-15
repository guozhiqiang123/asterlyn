import assert from "node:assert/strict";
import test from "node:test";

import {
  PluginPreferenceStore,
  PluginRuntime,
  createSilentPluginPreferenceSync,
} from "../src/application/plugins/index.ts";
import { PluginCompositionRuntime } from "../src/composition/plugin-runtime.ts";
import { ANDROID_GRADLE_PLUGIN } from "@asterlyn/plugin-android-gradle";

class MemoryStorage {
  value = null;
  getItem() { return this.value; }
  setItem(_key, value) { this.value = value; }
}

test("plugin preferences default enabled and use the Android task-tree default", () => {
  const storage = new MemoryStorage();
  const store = new PluginPreferenceStore(
    storage,
    [ANDROID_GRADLE_PLUGIN.manifest],
    createSilentPluginPreferenceSync(),
  );
  assert.equal(store.isEnabled(ANDROID_GRADLE_PLUGIN.id), true);
  assert.equal(store.setting(ANDROID_GRADLE_PLUGIN.id, "taskPresentation"), "all-tasks-tree");
  assert.equal(store.setSetting(ANDROID_GRADLE_PLUGIN.id, "taskPresentation", "quick-actions-tree"), true);
  assert.equal(store.setting(ANDROID_GRADLE_PLUGIN.id, "taskPresentation"), "quick-actions-tree");
  assert.equal(store.setSetting(ANDROID_GRADLE_PLUGIN.id, "taskPresentation", "not-a-mode"), false);
  store.dispose();
});

test("corrupt and unknown plugin preferences fail safe per known manifest", () => {
  const storage = new MemoryStorage();
  storage.value = JSON.stringify({
    version: 1,
    enabled: { unknown: false, "dev.asterlyn.android-gradle": "no" },
    settings: {
      unknown: { taskPresentation: "quick-actions-tree" },
      "dev.asterlyn.android-gradle": {
        taskPresentation: "unknown-mode",
        unknownSetting: true,
      },
    },
  });
  const store = new PluginPreferenceStore(storage, [ANDROID_GRADLE_PLUGIN.manifest], createSilentPluginPreferenceSync());
  assert.equal(store.isEnabled(ANDROID_GRADLE_PLUGIN.id), true);
  assert.equal(store.setting(ANDROID_GRADLE_PLUGIN.id, "taskPresentation"), "all-tasks-tree");
  assert.deepEqual(store.preferences.enabled, { [ANDROID_GRADLE_PLUGIN.id]: true });
  assert.deepEqual(Object.keys(store.preferences.settings[ANDROID_GRADLE_PLUGIN.id]), ["taskPresentation"]);
  store.dispose();
});

test("silently loading a plugin catalog preserves persisted preferences", () => {
  const storage = new MemoryStorage();
  storage.value = JSON.stringify({
    version: 1,
    enabled: { [ANDROID_GRADLE_PLUGIN.id]: false },
    settings: { [ANDROID_GRADLE_PLUGIN.id]: { taskPresentation: "quick-actions-tree" } },
  });
  const store = new PluginPreferenceStore(storage, [], createSilentPluginPreferenceSync());
  store.setManifests([ANDROID_GRADLE_PLUGIN.manifest], false);
  assert.equal(store.isEnabled(ANDROID_GRADLE_PLUGIN.id), false);
  assert.equal(store.setting(ANDROID_GRADLE_PLUGIN.id, "taskPresentation"), "quick-actions-tree");
  store.dispose();
});

test("management catalog is available without activating a workspace", async () => {
  const runtime = new PluginCompositionRuntime({
    registerCommand: () => () => undefined,
    replaceProviders: () => undefined,
    reportDiagnostic: () => undefined,
    reportError: (error) => { throw error; },
    loadPlugins: async () => [ANDROID_GRADLE_PLUGIN],
  });
  const snapshot = await runtime.loadManagementCatalog();
  assert.equal(snapshot.entries.length, 1);
  assert.equal(snapshot.entries[0].id, ANDROID_GRADLE_PLUGIN.id);
  assert.equal(snapshot.entries[0].matched, false);
  assert.equal(snapshot.entries[0].active, false);
  assert.equal(snapshot.entries[0].settingDescriptors[0].id, "taskPresentation");
  runtime.dispose();
});

test("disabled bundled plugins are not activated and re-enable activates once", async () => {
  const storage = new MemoryStorage();
  const preferences = new PluginPreferenceStore(storage, [], createSilentPluginPreferenceSync());
  let activations = 0;
  let disposals = 0;
  const plugin = {
    id: "fixture.plugin",
    version: "1.0.0",
    manifest: {
      id: "fixture.plugin",
      version: "1.0.0",
      nameKey: "name",
      descriptionKey: "description",
      localization: { defaultLocale: "en-US", locales: { "en-US": { name: "Fixture", description: "Fixture description" } } },
      settings: [],
    },
    matches: () => true,
    activate: (context) => {
      activations += 1;
      context.contribute({ kind: "provider", id: "tasks", label: "Fixture", snapshot: () => ({ status: "ready", tasks: [] }) });
      return { dispose: () => { disposals += 1; } };
    },
  };
  const runtime = new PluginCompositionRuntime({
    preferenceStore: preferences,
    registerCommand: () => () => undefined,
    replaceProviders: () => undefined,
    reportDiagnostic: () => undefined,
    reportError: (error) => { throw error; },
    loadPlugins: async () => [plugin],
  });
  await runtime.activateWorkspace({ root: "/repo", generation: 1 });
  await runtime.updateWorkspaceEvidence({ root: "/repo", generation: 1 }, { kind: "workspace-catalog", platform: "posix", files: [], truncated: false });
  assert.equal(activations, 1);
  assert.equal(runtime.managementSnapshot.entries[0].active, true);
  assert.equal(runtime.setPluginEnabled(plugin.id, false), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(disposals, 1);
  assert.equal(runtime.managementSnapshot.entries[0].enabled, false);
  assert.equal(runtime.managementSnapshot.entries[0].active, false);
  assert.equal(runtime.setPluginEnabled(plugin.id, true), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(activations, 2);
  assert.equal(disposals, 1);
  assert.equal(runtime.managementSnapshot.entries[0].active, true);
  runtime.dispose();
  preferences.dispose();
});

test("changing a plugin setting does not reactivate its contributions", async () => {
  const preferences = new PluginPreferenceStore(new MemoryStorage(), [], createSilentPluginPreferenceSync());
  let activations = 0;
  let disposals = 0;
  let providers = [];
  const plugin = {
    id: "fixture.settings",
    version: "1.0.0",
    manifest: {
      id: "fixture.settings",
      version: "1.0.0",
      nameKey: "name",
      descriptionKey: "description",
      localization: { defaultLocale: "en-US", locales: { "en-US": {
        name: "Fixture settings", description: "Fixture settings description",
        "settings.taskPresentation.label": "Task presentation",
        "settings.taskPresentation.all": "All tasks",
        "settings.taskPresentation.quick": "Quick actions",
      } } },
      settings: [{
        id: "taskPresentation",
        kind: "enum",
        labelKey: "settings.taskPresentation.label",
        defaultValue: "all-tasks-tree",
        options: [{ value: "all-tasks-tree", labelKey: "settings.taskPresentation.all" }, { value: "quick-actions-tree", labelKey: "settings.taskPresentation.quick" }],
      }],
    },
    matches: () => true,
    activate: (context) => {
      activations += 1;
      context.contribute({ kind: "provider", id: "tasks", label: "Fixture", snapshot: () => ({ status: "ready", tasks: [] }) });
      return { dispose: () => { disposals += 1; } };
    },
  };
  const runtime = new PluginCompositionRuntime({
    preferenceStore: preferences,
    registerCommand: () => () => undefined,
    replaceProviders: (_identity, next) => { providers = [...next]; },
    reportDiagnostic: () => undefined,
    reportError: (error) => { throw error; },
    loadPlugins: async () => [plugin],
  });
  await runtime.activateWorkspace({ root: "/repo", generation: 1 });
  await runtime.updateWorkspaceEvidence({ root: "/repo", generation: 1 }, { kind: "workspace-catalog", platform: "posix", files: [], truncated: false });
  assert.equal(activations, 1);
  assert.equal(providers.length, 1);
  assert.equal(runtime.setPluginSetting(plugin.id, "taskPresentation", "quick-actions-tree"), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(activations, 1);
  assert.equal(disposals, 0);
  assert.equal(providers.length, 1);
  assert.equal(runtime.managementSnapshot.entries[0].settings.taskPresentation, "quick-actions-tree");
  assert.equal(runtime.setPluginEnabled(plugin.id, false), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(activations, 1);
  assert.equal(disposals, 1);
  runtime.dispose();
  preferences.dispose();
});

test("plugin runtime rejects a manifest whose identity differs from the descriptor", async () => {
  const runtime = new PluginRuntime();
  await assert.rejects(
    runtime.activate({ root: "/repo", generation: 1 }, {}, [{
      id: "fixture.plugin",
      version: "1.0.0",
      manifest: { id: "other.plugin", version: "1.0.0", nameKey: "name", descriptionKey: "description", settings: [] },
      matches: () => true,
      activate: () => undefined,
    }]),
    /Invalid plugin manifest/u,
  );
  await runtime.dispose();
});
