import assert from "node:assert/strict";
import test from "node:test";

import { ANDROID_GRADLE_PLUGIN } from "../src/plugins/android-gradle/plugin.ts";
import { encodeAndroidGradleCachePayload } from "../src/plugins/android-gradle/task-cache.ts";

const evidence = {
  kind: "workspace-catalog", platform: "posix", truncated: false,
  files: [
    { workspacePath: "settings.gradle" }, { workspacePath: "build.gradle" }, { workspacePath: "gradlew" },
    { workspacePath: "app/src/main/AndroidManifest.xml" }, { workspacePath: "app/build.gradle" },
  ],
};
const fingerprint = (digest) => ({ status: "ready", digest });
const task = { id: ":app:assembleDebug", label: ":app:assembleDebug", group: "Build tasks", projectPath: ":app", runnable: false };
const output = "Tasks runnable from root project 'demo'\nBuild tasks\n-----------\n:app:assembleDebug - Assemble debug\n";

function setup({ readStatus = "fresh", readFingerprint = "a", computeDigest = "a", payloadTasks = [task], dirtyReason = null, staleReason = null } = {}) {
  const calls = { refresh: 0, writes: 0, dirty: 0 };
  const providerHolder = { provider: null };
  const payloadBase64 = payloadTasks === null ? null : encodeAndroidGradleCachePayload(payloadTasks, ANDROID_GRADLE_PLUGIN.id, ANDROID_GRADLE_PLUGIN.version, "gradle-tasks");
  const cache = {
    computeFingerprint: async () => fingerprint(computeDigest),
    read: async () => ({ status: readStatus, fingerprint: readFingerprint === null ? null : fingerprint(readFingerprint), payloadBase64, staleReason, dirtyReason }),
    write: async () => { calls.writes += 1; return { status: "stored" }; },
    markDirty: async () => { calls.dirty += 1; return { status: "dirty" }; },
  };
  const context = {
    identity: { root: "/repo", generation: 1 }, evidence, taskCache: cache,
    contribute: (contribution) => {
      if (contribution.kind === "provider") providerHolder.provider = contribution;
      if (contribution.kind === "provider") calls.refresh += 0;
      return { dispose() {} };
    },
  };
  return { context, providerHolder, calls };
}

const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test("activation only restores cache and never creates a Gradle refresh plan", async () => {
  const setupState = setup();
  const disposable = await ANDROID_GRADLE_PLUGIN.activate(setupState.context);
  const provider = setupState.providerHolder.provider;
  assert.equal(provider.snapshot().cache.status, "validating");
  assert.equal(setupState.calls.writes, 0);
  await settle();
  assert.equal(provider.snapshot().cache.status, "ready");
  disposable?.dispose();
});

test("cache mismatch, expiry, dirty, miss, and corruption map to stale without refresh", async () => {
  for (const [options, reason] of [
    [{ computeDigest: "b" }, "fingerprint-mismatch"],
    [{ readStatus: "stale", staleReason: "future-timestamp" }, "cache-expired"],
    [{ readStatus: "dirty", dirtyReason: "manual" }, "cache-miss"],
    [{ readStatus: "miss", payloadTasks: null }, "cache-miss"],
    [{ readStatus: "corrupt", payloadTasks: null }, "cache-corrupt"],
  ]) {
    const state = setup(options);
    await ANDROID_GRADLE_PLUGIN.activate(state.context);
    await settle();
    assert.equal(state.providerHolder.provider.snapshot().cache.status, "stale");
    assert.equal(state.providerHolder.provider.snapshot().cache.staleReason, reason);
    assert.equal(state.providerHolder.provider.snapshot().tasks.length, options.payloadTasks === null ? 0 : 1);
  }
});

test("refresh failure retains tasks and success writes before enabling execution", async () => {
  const state = setup();
  await ANDROID_GRADLE_PLUGIN.activate(state.context);
  await settle();
  const provider = state.providerHolder.provider;
  const plan = provider.refresh();
  plan.apply({ status: "failed", outputs: [], truncated: false, error: "Gradle failed" });
  assert.equal(provider.snapshot().status, "error");
  assert.equal(provider.snapshot().tasks.length, 1);
  assert.equal(provider.snapshot().tasks[0].runnable, false);
  assert.equal(provider.snapshot().cache.staleReason, "refresh-failed");
  const next = provider.refresh();
  next.apply({ status: "succeeded", outputs: [{ stream: "stdout", dataBase64: btoa(output) }], truncated: false, error: null });
  await settle();
  assert.equal(state.calls.writes, 1);
  assert.equal(provider.snapshot().cache.status, "ready");
  assert.equal(provider.snapshot().tasks[0].runnable, true);
});

test("run rechecks fingerprint and watcher invalidation never refreshes automatically", async () => {
  const state = setup();
  await ANDROID_GRADLE_PLUGIN.activate(state.context);
  await settle();
  const provider = state.providerHolder.provider;
  state.context.taskCache.computeFingerprint = async () => fingerprint("changed");
  assert.equal(await provider.run(":app:assembleDebug"), null);
  assert.equal(provider.snapshot().cache.status, "stale");
  state.context.taskCache.computeFingerprint = async () => fingerprint("a");
  provider.invalidate({ paths: ["README.md"], recovery: "none" });
  assert.equal(state.calls.dirty, 0);
  provider.invalidate({ paths: ["app/build.gradle"], recovery: "none" });
  assert.equal(state.calls.dirty, 1);
  assert.equal(provider.snapshot().cache.staleReason, "watcher-change");
  provider.invalidate({ paths: [], recovery: "backendOverflow" });
  assert.equal(state.calls.dirty, 2);
  assert.equal(provider.snapshot().cache.staleReason, "overflow-recovery");
  assert.equal(provider.refresh === undefined, false);
});

test("watcher invalidation wins over an in-flight cache write", async () => {
  const state = setup();
  await ANDROID_GRADLE_PLUGIN.activate(state.context);
  await settle();
  let resolveFingerprint;
  state.context.taskCache.computeFingerprint = async () => new Promise((resolve) => { resolveFingerprint = resolve; });
  const provider = state.providerHolder.provider;
  provider.refresh().apply({ status: "succeeded", outputs: [{ stream: "stdout", dataBase64: btoa(output) }], truncated: false, error: null });
  provider.invalidate({ paths: ["app/build.gradle"], recovery: "none" });
  resolveFingerprint(fingerprint("a"));
  await settle();
  assert.equal(state.calls.writes, 0);
  assert.equal(provider.snapshot().cache.status, "stale");
  assert.equal(provider.snapshot().cache.staleReason, "watcher-change");
});
