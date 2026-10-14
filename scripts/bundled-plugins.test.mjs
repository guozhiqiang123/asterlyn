import assert from "node:assert/strict";
import test from "node:test";

import { PluginRuntime } from "../src/application/plugins/index.ts";
import {
  ANDROID_GRADLE_PLUGIN_ID,
  BUNDLED_PLUGINS,
  detectAndroidGradlePluginEvidence,
} from "../src/plugins/index.ts";

const identity = { root: "/workspace/android", generation: 3 };

test("the bundled Android plugin activates from bounded catalog evidence with a host-reviewed refresh", async () => {
  const runtime = new PluginRuntime();
  const evidence = {
    kind: "workspace-catalog",
    platform: "posix",
    truncated: false,
    files: [
      { workspacePath: "settings.gradle.kts" },
      { workspacePath: "gradlew" },
      { workspacePath: "app/src/main/AndroidManifest.xml" },
    ],
  };
  const report = await runtime.activate(identity, evidence, BUNDLED_PLUGINS);
  assert.deepEqual(report.activated, [ANDROID_GRADLE_PLUGIN_ID]);
  const contributions = runtime.contributions.list();
  const provider = contributions.find((contribution) => contribution.qualifiedId === `${ANDROID_GRADLE_PLUGIN_ID}.gradle-tasks`);
  assert.ok(provider);
  assert.deepEqual(provider.snapshot(), {
    status: "unavailable",
    tasks: [],
    unavailableReason: "discovery-not-supported",
  });
  const plan = provider.refresh();
  assert.equal(plan.request.executablePath, "gradlew");
  plan.apply({ status: "succeeded", outputs: [{ stream: "stdout", dataBase64: Buffer.from("Tasks runnable from root project 'root'\nBuild tasks\n-----------\nassembleDebug - Assemble debug\n").toString("base64") }], truncated: false, error: null });
  assert.equal(provider.snapshot().status, "ready");
  provider.refresh().apply({ status: "cancelled", outputs: [], truncated: false, error: null });
  assert.match(provider.snapshot().error, /cancelled/u);
  provider.refresh().apply({ status: "succeeded", outputs: [], truncated: true, error: null });
  assert.match(provider.snapshot().error, /truncated/u);
  assert.deepEqual(detectAndroidGradlePluginEvidence({ identity, evidence }), {
    kind: "android-gradle-evidence",
    workspaceRoot: "/workspace/android",
    generation: 3,
    platform: "posix",
    bounded: true,
    catalogTruncated: false,
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
    truncated: false,
    files: [{ workspacePath: "README.md" }],
  }, BUNDLED_PLUGINS);
  assert.deepEqual(plain.skipped, [ANDROID_GRADLE_PLUGIN_ID]);
  const malformed = await runtime.activate(identity, {
    kind: "workspace-catalog",
    platform: "posix",
    truncated: false,
    files: [null],
  }, BUNDLED_PLUGINS);
  assert.deepEqual(malformed.skipped, [ANDROID_GRADLE_PLUGIN_ID]);
});
