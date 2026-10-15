import assert from "node:assert/strict";
import test from "node:test";

import { PluginRuntime } from "../src/application/plugins/index.ts";
import {
  ANDROID_GRADLE_PLUGIN_ID,
  BUNDLED_PLUGINS,
} from "../src/plugins/index.ts";

const identity = { root: "/workspace/android", generation: 3 };

test("the bundled Android plugin activates from bounded catalog evidence with a host-reviewed refresh", async () => {
  const runtime = runtimeWithCache();
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
  await settle();
  assert.equal(provider.snapshot().cache.staleReason, "cache-miss");
  const plan = provider.refresh();
  assert.equal(plan.request.executablePath, "gradlew");
  plan.apply({ status: "succeeded", outputs: [{ stream: "stdout", dataBase64: Buffer.from("Tasks runnable from root project 'root'\nBuild tasks\n-----------\nassembleDebug - Assemble debug\ninstallDebug - Install debug\n").toString("base64") }], truncated: false, error: null });
  await settle();
  assert.equal(provider.snapshot().status, "ready");
  assert.deepEqual(provider.snapshot().tasks.find((task) => task.id === ":assembleDebug").metadata, {
    "android.quickAction.kind": "assemble",
    "android.quickAction.module": ":",
    "android.quickAction.variant": "Debug",
  });
  assert.deepEqual((await provider.run(":assembleDebug")).artifactSearch, { hints: ["build/outputs/apk"] });
  assert.equal((await provider.run(":installDebug")).artifactSearch, undefined);
  provider.refresh().apply({ status: "cancelled", outputs: [], truncated: false, error: null });
  assert.match(provider.snapshot().error, /cancelled/u);
  assert.deepEqual(provider.snapshot().tasks.map((task) => task.id), [":assembleDebug", ":installDebug"]);
  provider.refresh().apply({ status: "succeeded", outputs: [], truncated: true, error: null });
  assert.match(provider.snapshot().error, /truncated/u);
  assert.deepEqual(provider.snapshot().tasks.map((task) => task.id), [":assembleDebug", ":installDebug"]);
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

test("the bundled Android plugin accepts a multi-chunk 16000-task catalog", async () => {
  const runtime = runtimeWithCache();
  await runtime.activate(identity, {
    kind: "workspace-catalog",
    platform: "posix",
    truncated: false,
    files: [
      { workspacePath: "settings.gradle.kts" },
      { workspacePath: "gradlew" },
      { workspacePath: "app/src/main/AndroidManifest.xml" },
    ],
  }, BUNDLED_PLUGINS);
  const provider = runtime.contributions.list()
    .find((contribution) => contribution.qualifiedId === `${ANDROID_GRADLE_PLUGIN_ID}.gradle-tasks`);
  assert.ok(provider);
  const body = [
    "Tasks runnable from root project 'large'",
    "Build tasks",
    "-----------",
    ...Array.from({ length: 16_000 }, (_, index) => `task${String(index).padStart(5, "0")} - Generated task ${index} with enough descriptive output for a realistic catalog`),
    "",
  ].join("\n");
  const bytes = Buffer.from(body);
  const outputs = [];
  for (let offset = 0; offset < bytes.length; offset += 16 * 1024) {
    outputs.push({ stream: "stdout", dataBase64: bytes.subarray(offset, offset + 16 * 1024).toString("base64") });
  }
  provider.refresh().apply({ status: "succeeded", outputs, truncated: false, error: null });
  await settle();
  assert.equal(provider.snapshot().status, "ready");
  assert.equal(provider.snapshot().tasks.length, 16_000);
  assert.equal(provider.snapshot().tasks.at(-1).id, ":task15999");
});

function runtimeWithCache() {
  const fingerprint = { status: "ready", digest: "a".repeat(64) };
  return new PluginRuntime(undefined, undefined, () => ({
    computeFingerprint: async () => fingerprint,
    read: async (providerId) => ({ status: "miss", pluginId: ANDROID_GRADLE_PLUGIN_ID, providerId, fingerprint: null, payloadBase64: null, updatedAtEpochMs: null, lastAccessEpochMs: null, staleReason: null, dirtyReason: null }),
    write: async (providerId) => ({ status: "stored", pluginId: ANDROID_GRADLE_PLUGIN_ID, providerId, fingerprint, updatedAtEpochMs: Date.now(), lastAccessEpochMs: Date.now(), dirtyReason: null }),
    markDirty: async (providerId, dirtyReason) => ({ status: "dirty", pluginId: ANDROID_GRADLE_PLUGIN_ID, providerId, fingerprint: null, updatedAtEpochMs: null, lastAccessEpochMs: null, dirtyReason }),
  }));
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
