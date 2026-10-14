import assert from "node:assert/strict";
import test from "node:test";

import { PluginRuntime } from "../src/application/plugins/index.ts";
import {
  ANDROID_GRADLE_PLUGIN_ID,
  BUNDLED_PLUGINS,
  detectAndroidGradlePluginEvidence,
} from "../src/plugins/index.ts";

const identity = { root: "/workspace/android", generation: 3 };

test("the bundled Android plugin activates from bounded catalog evidence without contributions", async () => {
  const runtime = new PluginRuntime();
  const evidence = {
    kind: "workspace-catalog",
    platform: "posix",
    files: [
      { workspacePath: "settings.gradle.kts" },
      { workspacePath: "gradlew" },
      { workspacePath: "app/src/main/AndroidManifest.xml" },
    ],
  };
  const report = await runtime.activate(identity, evidence, BUNDLED_PLUGINS);
  assert.deepEqual(report.activated, [ANDROID_GRADLE_PLUGIN_ID]);
  assert.deepEqual(runtime.contributions.list(), []);
  assert.deepEqual(detectAndroidGradlePluginEvidence({ identity, evidence }), {
    kind: "android-gradle-evidence",
    workspaceRoot: "/workspace/android",
    generation: 3,
    platform: "posix",
    bounded: true,
    gradle: true,
    android: true,
    wrapper: "gradlew",
    evidence: [
      "app/src/main/AndroidManifest.xml",
      "gradlew",
      "settings.gradle.kts",
    ],
  });
});

test("the bundled Android plugin stays inactive for plain and malformed catalogs", async () => {
  const runtime = new PluginRuntime();
  const plain = await runtime.activate(identity, {
    kind: "workspace-catalog",
    platform: "posix",
    files: [{ workspacePath: "README.md" }],
  }, BUNDLED_PLUGINS);
  assert.deepEqual(plain.skipped, [ANDROID_GRADLE_PLUGIN_ID]);
  const malformed = await runtime.activate(identity, {
    kind: "workspace-catalog",
    platform: "posix",
    files: [null],
  }, BUNDLED_PLUGINS);
  assert.deepEqual(malformed.skipped, [ANDROID_GRADLE_PLUGIN_ID]);
});
