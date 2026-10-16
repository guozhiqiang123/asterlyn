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

test("incomplete Android Run configuration explains the limitation without exposing a fake action", () => {
  const html = renderPluginWorkbenchView("run", manifest.id, {
    targetProviders: [],
    runConfigurationProviders: [{
      qualifiedId: `${manifest.id}:android-run-configurations`,
      pluginId: manifest.id,
      providerId: "android-run-configurations",
      snapshot: {
        status: "ready",
        selectedConfigurationId: "android-app",
        configurations: [{
          id: "android-app",
          label: "Android app",
          detail: "fallback",
          status: "incomplete",
          targetProviderId: "android-devices",
          metadata: {
            labelKey: "run.configuration.androidApp",
            detailKey: "run.configuration.incomplete",
          },
        }],
      },
    }],
  }, entry, "en-US");

  assert.match(html, /Android app/u);
  assert.match(html, /application ID and launcher activity/u);
  assert.doesNotMatch(html, /<button/u);
});
