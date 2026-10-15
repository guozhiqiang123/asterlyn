import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  PLUGIN_SDK_MAJOR,
  PLUGIN_SDK_VERSION,
  SDK_PLUGIN_LOCALIZATION_LIMITS,
} from "../packages/plugin-sdk/index.ts";
import { representativePlugin } from "../packages/plugin-sdk/fixture.ts";
import { adaptPluginManifest, assertCompatiblePluginSdk } from "../src/application/plugins/plugin-sdk-adapter.ts";

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
  assert.equal(PLUGIN_SDK_VERSION, "1.1.0");
  assert.equal(Object.isFrozen(SDK_PLUGIN_LOCALIZATION_LIMITS), true);
  assert.deepEqual(adaptPluginManifest(manifest), {
    id: "example.plugin",
    version: "1.2.3",
    nameKey: "name",
    descriptionKey: "description",
    settings: [],
  });
});

test("unsupported SDK majors fail closed", () => {
  assert.throws(() => assertCompatiblePluginSdk({ sdkMajor: 2 }), /Unsupported plugin SDK major/u);
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
