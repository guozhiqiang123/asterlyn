import assert from "node:assert/strict";
import test from "node:test";

import { createPluginProcessQueriesCapability } from "../src/composition/plugin-process-query-capability.ts";
import { createPluginWorkspaceStateCapability } from "../src/composition/plugin-workspace-state-capability.ts";

const plugin = {
  id: "dev.example.android",
  version: "1.0.0",
  manifest: {
    processQueries: [{ id: "adb.devices" }],
  },
};
const identity = { root: "/workspace/android", generation: 2 };

test("process query capability binds plugin, workspace, declared query, and decoded output", async () => {
  const calls = [];
  const capability = createPluginProcessQueriesCapability({
    executePluginProcessQuery: async (root, pluginId, queryId) => {
      calls.push({ root, pluginId, queryId });
      return {
        protocolVersion: 1,
        pluginId,
        queryId,
        status: "succeeded",
        stdoutBase64: btoa("List of devices attached\n"),
        stderrBase64: "",
        truncated: false,
        exitCode: 0,
        error: null,
      };
    },
  }, plugin, identity);
  assert.ok(capability);
  const result = await capability.execute("adb.devices");
  assert.equal(result.stdout, "List of devices attached\n");
  assert.deepEqual(calls, [{ root: identity.root, pluginId: plugin.id, queryId: "adb.devices" }]);
  await assert.rejects(() => capability.execute("adb.shell"), /not declared/u);
});

test("process query capability rejects mismatched native identities", async () => {
  const capability = createPluginProcessQueriesCapability({
    executePluginProcessQuery: async () => ({
      protocolVersion: 1,
      pluginId: "dev.other",
      queryId: "adb.devices",
      status: "succeeded",
      stdoutBase64: "",
      stderrBase64: "",
      truncated: false,
      exitCode: 0,
      error: null,
    }),
  }, plugin, identity);
  await assert.rejects(() => capability.execute("adb.devices"), /identity/u);
});

test("workspace state is namespaced per plugin and workspace and bounded", async () => {
  const storage = new Map();
  const adapter = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  const capability = createPluginWorkspaceStateCapability(adapter, plugin, identity);
  assert.ok(capability);
  await capability.write("selectedDevice", "phone-1");
  assert.equal(await capability.read("selectedDevice"), "phone-1");
  assert.equal(storage.size, 1);
  assert.match([...storage.keys()][0], /dev\.example\.android/u);
  await assert.rejects(() => capability.write("bad/key", "value"), /Invalid/u);
  await assert.rejects(() => capability.write("large", "x".repeat(16_385)), /too large/u);
});
