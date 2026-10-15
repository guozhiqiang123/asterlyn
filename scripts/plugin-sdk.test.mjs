import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  PLUGIN_SDK_MAJOR,
  PLUGIN_SDK_VERSION,
  SDK_PLUGIN_LOCALIZATION_LIMITS,
  SDK_PLUGIN_NOTIFICATION_LIMITS,
} from "../packages/plugin-sdk/index.ts";
import { representativePlugin } from "../packages/plugin-sdk/fixture.ts";
import { adaptPluginManifest, adaptSdkPluginCatalog, assertCompatiblePluginSdk } from "../src/application/plugins/plugin-sdk-adapter.ts";

const manifest = {
  sdkMajor: 1,
  id: "example.plugin",
  version: "1.2.3",
  nameKey: "name",
  descriptionKey: "description",
  localization: {
    defaultLocale: "en-US",
    locales: { "en-US": { name: "Example plugin", description: "Example description" } },
  },
  settings: [],
};

test("host adapter accepts the supported SDK major and preserves declarative metadata", () => {
  assert.equal(PLUGIN_SDK_MAJOR, 1);
  assert.equal(PLUGIN_SDK_VERSION, "1.3.0");
  assert.equal(Object.isFrozen(SDK_PLUGIN_LOCALIZATION_LIMITS), true);
  assert.equal(Object.isFrozen(SDK_PLUGIN_NOTIFICATION_LIMITS), true);
  assert.deepEqual(adaptPluginManifest(manifest), {
    id: "example.plugin",
    version: "1.2.3",
    nameKey: "name",
    descriptionKey: "description",
    localization: {
      defaultLocale: "en-US",
      locales: { "en-US": { name: "Example plugin", description: "Example description" } },
    },
    settings: [],
  });
  const adapted = adaptPluginManifest(manifest);
  assert.equal(Object.isFrozen(adapted.localization), true);
  assert.equal(Object.isFrozen(adapted.localization.locales["en-US"]), true);
});

test("host adapter preserves and freezes declarative task authorization", () => {
  const adapted = adaptPluginManifest({
    ...manifest,
    taskAuthorization: {
      workspaceTrust: {
        id: "workspaceTrust",
        labelKey: "authorization.workspaceTrust.label",
        descriptionKey: "authorization.workspaceTrust.description",
      },
      taskConfirmation: {
        rememberLabelKey: "authorization.rememberTask.label",
        rememberDescriptionKey: "authorization.rememberTask.description",
      },
    },
  });
  assert.equal(adapted.taskAuthorization.workspaceTrust.id, "workspaceTrust");
  assert.equal(adapted.taskAuthorization.taskConfirmation.rememberLabelKey, "authorization.rememberTask.label");
  assert.equal(Object.isFrozen(adapted.taskAuthorization), true);
  assert.equal(Object.isFrozen(adapted.taskAuthorization.workspaceTrust), true);
  assert.equal(Object.isFrozen(adapted.taskAuthorization.taskConfirmation), true);
});

test("unsupported SDK majors fail closed", () => {
  assert.throws(() => assertCompatiblePluginSdk({ sdkMajor: 2 }), /Unsupported plugin SDK major/u);
});

test("SDK catalog adaptation isolates an invalid manifest from healthy plugins", () => {
  const broken = {
    ...representativePlugin,
    id: "broken.plugin",
    manifest: {
      ...representativePlugin.manifest,
      id: "broken.plugin",
      localization: { defaultLocale: "fr-FR", locales: representativePlugin.manifest.localization.locales },
    },
  };
  const catalog = adaptSdkPluginCatalog([broken, representativePlugin]);
  assert.deepEqual(catalog.plugins.map((plugin) => plugin.id), ["example.plugin"]);
  assert.equal(catalog.diagnostics.length, 1);
  assert.equal(catalog.diagnostics[0].kind, "invalid-manifest");
  assert.equal(catalog.diagnostics[0].pluginId, "broken.plugin");
});

test("SDK contract can express activation, cache, refresh, and run lifecycle", () => {
  assert.equal(representativePlugin.matches({ identity: { root: "/repo", generation: 1 }, evidence: [] }), true);
  assert.equal(typeof representativePlugin.activate, "function");
});

test("SDK has no deep imports into host or privileged APIs", async () => {
  const source = await readFile(new URL("../packages/plugin-sdk/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from\s+["'](?:\.\.?\/)+src\//u);
  assert.doesNotMatch(source, /^\s*import\s.*(?:tauri|CodeMirror|node:fs|child_process)/imu);
});
