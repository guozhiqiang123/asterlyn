import assert from "node:assert/strict";
import test from "node:test";

import { createPluginTaskCacheCapability } from "../src/composition/plugin-task-cache-capability.ts";

test("plugin cache capability binds workspace and plugin identities", async () => {
  const calls = [];
  const fingerprint = {
    protocolVersion: 1, status: "ready", workspaceRoot: "/repo", algorithm: "sha256",
    digest: "a".repeat(64), files: [], truncated: false, reason: null,
    os: "macos", arch: "aarch64", javaHomeDigest: null,
  };
  const bridge = {
    async computeWorkspaceFingerprint(root, paths) { calls.push(["fingerprint", root, paths]); return fingerprint; },
    async readPluginTaskCache(root, pluginId, providerId) { calls.push(["read", root, pluginId, providerId]); return {}; },
    async writePluginTaskCache(root, pluginId, providerId, value, payload) { calls.push(["write", root, pluginId, providerId, value, payload]); return {}; },
    async markPluginTaskCacheDirty(root, pluginId, providerId, reason) { calls.push(["dirty", root, pluginId, providerId, reason]); return {}; },
    async cleanupPluginTaskCache() { return {}; },
  };
  const capability = createPluginTaskCacheCapability(bridge, { root: "/repo", generation: 4 }, "dev.plugin");
  await capability.computeFingerprint(["settings.gradle"]);
  await capability.read("tasks");
  await capability.write("tasks", fingerprint, "e30=");
  await capability.markDirty("tasks", "workspace-change");
  assert.deepEqual(calls.map((call) => call.slice(0, 4)), [
    ["fingerprint", "/repo", ["settings.gradle"]],
    ["read", "/repo", "dev.plugin", "tasks"],
    ["write", "/repo", "dev.plugin", "tasks"],
    ["dirty", "/repo", "dev.plugin", "tasks"],
  ]);
  assert.throws(() => capability.read("../other"), /Invalid plugin cache provider ID/u);
});

test("missing desktop cache support fails closed without exposing raw addressing", async () => {
  const capability = createPluginTaskCacheCapability(undefined, { root: "/repo", generation: 1 }, "dev.plugin");
  assert.equal((await capability.computeFingerprint([])).status, "unavailable");
  const read = await capability.read("tasks");
  assert.deepEqual([read.status, read.pluginId, read.providerId], ["unavailable", "dev.plugin", "tasks"]);
});
