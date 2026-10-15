import assert from "node:assert/strict";
import test from "node:test";

import { PluginTasksRuntime } from "../src/composition/plugin-tasks-runtime.ts";

test("plugin task authorization loads per workspace and revokes through the host bridge", async () => {
  const reads = [];
  const writes = [];
  const bridge = {
    native: false,
    readWorkspaceTrust: async (workspaceRoot, pluginId) => {
      reads.push({ workspaceRoot, pluginId });
      return { protocolVersion: 1, workspaceRoot, pluginId, state: "trusted" };
    },
    setWorkspaceTrust: async (workspaceRoot, pluginId, state) => {
      writes.push({ workspaceRoot, pluginId, state });
      return { protocolVersion: 1, workspaceRoot, pluginId, state };
    },
    prepareTaskExecution: async () => { throw new Error("not used"); },
    startTaskExecution: async () => { throw new Error("not used"); },
    cancelTaskExecution: async () => {},
    subscribeTaskSession: async () => () => {},
    discoverTaskArtifacts: async () => { throw new Error("not used"); },
    revealTaskArtifact: async () => {},
    readPluginTaskCache: async () => null,
    writePluginTaskCache: async () => {},
    removePluginTaskCache: async () => {},
  };
  const root = {
    addEventListener: () => undefined,
    matches: () => false,
    querySelector: () => null,
  };
  const runtime = new PluginTasksRuntime(root, {
    copy: () => ({ refresh: "Refresh" }),
    registerCommand: () => () => undefined,
    reportError: (error) => { throw error; },
    executionBridge: bridge,
    artifactBridge: bridge,
    taskCacheBridge: bridge,
  });

  await runtime.activateWorkspace({ root: "/repo-a", generation: 1 });
  let snapshot = await runtime.loadPluginManagement();
  const pluginId = "dev.asterlyn.android-gradle";
  assert.equal(snapshot.entries.find((entry) => entry.id === pluginId)?.workspaceTrust, "trusted");
  assert.deepEqual(reads, [{ workspaceRoot: "/repo-a", pluginId }]);

  assert.equal(await runtime.setPluginWorkspaceTrust(pluginId, false), true);
  assert.deepEqual(writes, [{ workspaceRoot: "/repo-a", pluginId, state: "denied" }]);
  assert.equal(runtime.pluginManagementSnapshot.entries.find((entry) => entry.id === pluginId)?.workspaceTrust, "denied");

  await runtime.activateWorkspace({ root: "/repo-b", generation: 2 });
  snapshot = runtime.pluginManagementSnapshot;
  assert.equal(snapshot.entries.find((entry) => entry.id === pluginId)?.workspaceTrust, "trusted");
  assert.deepEqual(reads.at(-1), { workspaceRoot: "/repo-b", pluginId });
  runtime.dispose();
});
