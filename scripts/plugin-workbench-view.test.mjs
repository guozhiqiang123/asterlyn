import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { renderPluginWorkbenchView } from "../src/composition/plugin-workbench-view.ts";

const manifest = JSON.parse(await readFile(
  new URL("../node_modules/@asterlyn/plugin-android-gradle/manifest.json", import.meta.url),
  "utf8",
));

const entry = {
  id: manifest.id,
  version: manifest.version,
  nameKey: manifest.nameKey,
  descriptionKey: manifest.descriptionKey,
  localization: manifest.localization,
  workspaceTool: manifest.workspaceTool,
  enabled: true,
  matched: true,
  active: true,
  settingDescriptors: manifest.settings,
  settings: {},
  taskAuthorization: manifest.taskAuthorization,
  diagnostics: [],
};

test("Android device view localizes target state and keeps unsafe targets visible but disabled", () => {
  const html = renderPluginWorkbenchView("devices", manifest.id, {
    targetProviders: [{
      qualifiedId: `${manifest.id}:android-devices`,
      pluginId: manifest.id,
      providerId: "android-devices",
      snapshot: {
        status: "ready",
        selectedTargetId: "online-1",
        targets: [
          { id: "online-1", label: "Pixel 10", detail: "physical", status: "online", selectable: true, metadata: {} },
          { id: "offline-1", label: "Old phone", detail: "USB", status: "unauthorized", selectable: false, metadata: {} },
        ],
      },
    }],
    runConfigurationProviders: [],
  }, entry, "zh-CN");

  assert.match(html, /Android 设备/u);
  assert.match(html, /已发现 2 台/u);
  assert.match(html, /Pixel 10/u);
  assert.match(html, />在线</u);
  assert.match(html, />未授权</u);
  assert.match(html, /data-execution-target="offline-1" disabled/u);
  assert.doesNotMatch(html, /Refresh devices|刷新设备/u);
});

test("ready Android Run configurations use host controls and retain exact Gradle task identity", () => {
  const html = renderPluginWorkbenchView("run", manifest.id, {
    targetProviders: [{
      qualifiedId: `${manifest.id}:android-devices`,
      pluginId: manifest.id,
      providerId: "android-devices",
      snapshot: {
        status: "ready",
        selectedTargetId: "phone-1",
        targets: [
          { id: "phone-1", label: "Pixel 10", detail: "USB", status: "online", selectable: true, metadata: {} },
          { id: "offline-1", label: "Old phone", status: "offline", selectable: false, metadata: {} },
        ],
      },
    }],
    runConfigurationProviders: [{
      qualifiedId: `${manifest.id}:android-run-configurations`,
      pluginId: manifest.id,
      providerId: "android-run-configurations",
      snapshot: {
        status: "ready",
        selectedConfigurationId: "android-run::app:installDebug",
        configurations: [{
          id: "android-run::app:installDebug",
          label: "app · Debug",
          detail: ":app:installDebug",
          status: "ready",
          targetProviderId: "android-devices",
          metadata: { module: ":app", variant: "Debug", taskId: ":app:installDebug" },
        }],
      },
    }],
  }, entry, "en-US");

  assert.match(html, /data-run-configuration-provider=/u);
  assert.match(html, /app · Debug/u);
  assert.match(html, /:app:installDebug/u);
  assert.match(html, /data-run-target-provider=/u);
  assert.match(html, /Pixel 10 — USB/u);
  assert.match(html, /offline-1[^>]*disabled/u);
  assert.match(html, /data-target-provider-refresh=/u);
  assert.match(html, /aria-label="Refresh devices"/u);
  assert.match(html, /class="primary-button plugin-run-button"[^>]*data-plugin-run-action/u);
  assert.doesNotMatch(html, /data-plugin-run-action disabled/u);
  assert.match(html, />Run<\/button>/u);
});

test("Android Run action is disabled until a device is explicitly selected", () => {
  const html = renderPluginWorkbenchView("run", manifest.id, {
    targetProviders: [{
      qualifiedId: `${manifest.id}:android-devices`,
      pluginId: manifest.id,
      providerId: "android-devices",
      snapshot: {
        status: "ready",
        selectedTargetId: null,
        targets: [{ id: "phone-1", label: "Pixel 10", status: "online", selectable: true, metadata: {} }],
      },
    }],
    runConfigurationProviders: [{
      qualifiedId: `${manifest.id}:android-run-configurations`,
      pluginId: manifest.id,
      providerId: "android-run-configurations",
      snapshot: {
        status: "ready",
        selectedConfigurationId: "android-run::app:installDebug",
        configurations: [{
          id: "android-run::app:installDebug",
          label: "app · Debug",
          status: "ready",
          targetProviderId: "android-devices",
          metadata: {},
        }],
      },
    }],
  }, entry, "en-US");

  assert.match(html, /<option value="" selected disabled>Target device<\/option>/u);
  assert.match(html, /data-plugin-run-action disabled/u);
});

test("refreshing Android targets disables both the device picker and Run action", () => {
  const html = renderPluginWorkbenchView("run", manifest.id, {
    targetProviders: [{
      qualifiedId: `${manifest.id}:android-devices`,
      pluginId: manifest.id,
      providerId: "android-devices",
      snapshot: {
        status: "loading",
        selectedTargetId: "phone-1",
        targets: [{ id: "phone-1", label: "Pixel 10", status: "online", selectable: true, metadata: {} }],
      },
    }],
    runConfigurationProviders: [{
      qualifiedId: `${manifest.id}:android-run-configurations`,
      pluginId: manifest.id,
      providerId: "android-run-configurations",
      snapshot: {
        status: "ready",
        selectedConfigurationId: "android-run::app:installDebug",
        configurations: [{
          id: "android-run::app:installDebug",
          label: "app · Debug",
          status: "ready",
          targetProviderId: "android-devices",
          metadata: {},
        }],
      },
    }],
  }, entry, "en-US");

  assert.match(html, /data-run-target-provider="[^"]+"[^>]*disabled/u);
  assert.match(html, /data-target-provider-refresh="[^"]+"[^>]*disabled/u);
  assert.match(html, /data-plugin-run-action disabled/u);
  assert.match(html, /class="spinner"/u);
});

test("active Android Run action becomes a localized Stop button", () => {
  const html = renderPluginWorkbenchView("run", manifest.id, {
    targetProviders: [{
      qualifiedId: `${manifest.id}:android-devices`,
      pluginId: manifest.id,
      providerId: "android-devices",
      snapshot: {
        status: "ready",
        selectedTargetId: "phone-1",
        targets: [{ id: "phone-1", label: "Pixel 10", status: "online", selectable: true, metadata: {} }],
      },
    }],
    runConfigurationProviders: [{
      qualifiedId: `${manifest.id}:android-run-configurations`,
      pluginId: manifest.id,
      providerId: "android-run-configurations",
      snapshot: {
        status: "ready",
        selectedConfigurationId: "android-run::app:installDebug",
        configurations: [{
          id: "android-run::app:installDebug",
          label: "app · Debug",
          status: "ready",
          targetProviderId: "android-devices",
          metadata: {},
        }],
      },
    }],
  }, entry, "zh-CN", {
    requestId: "run-1",
    pluginId: manifest.id,
    label: "app · Debug",
    status: "running",
    phase: "building",
    error: null,
  });

  assert.match(html, /data-plugin-run-action[^>]*>停止<\/button>/u);
  assert.doesNotMatch(html, /data-plugin-run-action disabled/u);
});

test("completed Android Run status does not retain an in-progress phase message", () => {
  const html = renderPluginWorkbenchView("run", manifest.id, {
    targetProviders: [{
      qualifiedId: `${manifest.id}:android-devices`,
      pluginId: manifest.id,
      providerId: "android-devices",
      snapshot: {
        status: "ready",
        selectedTargetId: "phone-1",
        targets: [{ id: "phone-1", label: "Pixel 10", status: "online", selectable: true, metadata: {} }],
      },
    }],
    runConfigurationProviders: [{
      qualifiedId: `${manifest.id}:android-run-configurations`,
      pluginId: manifest.id,
      providerId: "android-run-configurations",
      snapshot: {
        status: "ready",
        selectedConfigurationId: "android-run::app:installDebug",
        configurations: [{
          id: "android-run::app:installDebug",
          label: "app · Debug",
          status: "ready",
          targetProviderId: "android-devices",
          metadata: {},
        }],
      },
    }],
  }, entry, "zh-CN", {
    requestId: "run-1",
    pluginId: manifest.id,
    label: "app · Debug",
    status: "succeeded",
    phase: "launching",
    error: null,
  });

  assert.match(html, /Android 应用已启动。/u);
  assert.doesNotMatch(html, /正在启动应用/u);
  assert.match(html, /data-plugin-run-action[^>]*>运行<\/button>/u);
});
