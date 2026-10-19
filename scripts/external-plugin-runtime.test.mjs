import assert from "node:assert/strict";
import test from "node:test";

import { PluginContributionRegistry } from "../src/application/plugins/plugin-registry.ts";
import { ExternalPluginRuntime } from "../src/composition/external-plugin-runtime.ts";

const pluginId = "dev.asterlyn.fixture";
const identity = { root: "/repo", generation: 7 };
const evidence = {
  kind: "workspace-catalog",
  platform: "posix",
  files: [{ workspacePath: "settings.gradle.kts" }],
  truncated: false,
};

function installation() {
  return {
    schemaVersion: 1,
    generation: 1,
    recovered: false,
    plugins: [{
      pluginId,
      repository: "asterlyn/plugin-fixture",
      enabled: true,
      bundledFallback: true,
      activeVersion: null,
      knownGoodVersion: null,
      pendingVersion: "1.2.3",
      versions: [{
        version: "1.2.3",
        packageDigest: `sha256:${"a".repeat(64)}`,
        admittedAtEpochMs: 1,
        runtimeStatus: "pendingRuntime",
      }],
    }],
  };
}

test("activates admitted external contributions and removes them on deactivation", async () => {
  const registry = new PluginContributionRegistry();
  const calls = [];
  let eventListener = null;
  let notificationListener = null;
  const bridge = {
    activate: async (...arguments_) => {
      calls.push(["activate", ...arguments_]);
      return {
        pluginId,
        pluginVersion: "1.2.3",
        packageDigest: `sha256:${"a".repeat(64)}`,
        sessionId: "session-1",
        contributions: [{
          kind: "command",
          id: "fixture-command",
          payload: {},
          callbacks: { title: "title", detail: "detail", execute: "execute" },
        }],
      };
    },
    invoke: async (_pluginId, handle, operation) => {
      calls.push(["invoke", handle, operation]);
      if (handle === "title") return "Fixture command";
      if (handle === "detail") return "Runs outside the renderer";
      if (handle === "execute") return null;
      throw new Error(`Unexpected callback: ${handle}`);
    },
    deactivate: async (id) => { calls.push(["deactivate", id]); },
    diagnostics: async () => ({ stderr: "", stderrTruncated: false, protocolDiagnostics: [] }),
    subscribe: async (listener) => { eventListener = listener; return () => { eventListener = null; }; },
    subscribeNotifications: async (listener) => { notificationListener = listener; return () => { notificationListener = null; }; },
  };
  const notifications = [];
  const runtime = new ExternalPluginRuntime({
    registry,
    bridge,
    marketplace: { listPluginInstallations: async () => installation() },
    locale: () => "zh-CN",
    reportError: (error) => { throw error; },
    notification: (event) => { notifications.push(event); },
  });

  assert.deepEqual(await runtime.activate(identity, evidence, () => true), [pluginId]);
  const command = registry.get(`${pluginId}.fixture-command`);
  assert.equal(command?.kind, "command");
  assert.equal(command.title(), "Fixture command");
  await command.execute();
  notificationListener({ pluginId, kind: "success", messageKey: "run.completed" });
  assert.deepEqual(notifications, [{ pluginId, kind: "success", messageKey: "run.completed" }]);
  assert.equal(typeof eventListener, "function");
  assert.deepEqual(calls[0].slice(0, 4), ["activate", pluginId, "/repo", 7]);

  await runtime.deactivate();
  assert.equal(registry.get(`${pluginId}.fixture-command`), null);
  assert.equal(calls.some((call) => call[0] === "deactivate"), true);
  await runtime.dispose();
});

test("refreshes cached task projections from isolated runtime events", async () => {
  const registry = new PluginContributionRegistry();
  let runtimeEvent = null;
  let taskLabel = "first";
  const calls = [];
  const bridge = {
    activate: async () => ({
      pluginId,
      pluginVersion: "1.2.3",
      packageDigest: `sha256:${"a".repeat(64)}`,
      sessionId: "session-2",
      contributions: [{
        kind: "taskProvider",
        id: "tasks",
        payload: { label: "Fixture" },
        callbacks: { snapshot: "snapshot", subscribe: "subscribe" },
      }],
    }),
    invoke: async (_pluginId, handle, operation, payload) => {
      calls.push([handle, operation]);
      if (handle === "snapshot") {
        return { status: "ready", tasks: [{ id: ":app:run", label: taskLabel, runnable: true }] };
      }
      if (handle === "subscribe") {
        assert.equal(payload.arguments[0].$asterlynListener.subscriptionHandle, "subscription-1");
        return { dispose: { $asterlynCallback: { handle: "dispose", operation: "dispose" } } };
      }
      if (handle === "dispose") return null;
      throw new Error(`Unexpected callback: ${handle}`);
    },
    deactivate: async () => undefined,
    diagnostics: async () => ({ stderr: "", stderrTruncated: false, protocolDiagnostics: [] }),
    subscribe: async (listener) => { runtimeEvent = listener; return () => undefined; },
    subscribeNotifications: async () => () => undefined,
  };
  const runtime = new ExternalPluginRuntime({
    registry,
    bridge,
    marketplace: { listPluginInstallations: async () => installation() },
    locale: () => "en-US",
    reportError: (error) => { throw error; },
  });
  await runtime.activate(identity, evidence, () => true);
  const provider = registry.get(`${pluginId}.tasks`);
  assert.equal(provider.snapshot().tasks[0].label, "first");
  let changes = 0;
  const release = provider.subscribe(() => { changes += 1; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  taskLabel = "second";
  runtimeEvent({ pluginId, subscriptionHandle: "subscription-1", payload: null });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(changes, 1);
  assert.equal(provider.snapshot().tasks[0].label, "second");
  release.dispose();
  await runtime.dispose();
  assert.equal(calls.some(([handle]) => handle === "dispose"), true);
});

test("skips disabled installations before starting a process", async () => {
  let activations = 0;
  const runtime = new ExternalPluginRuntime({
    registry: new PluginContributionRegistry(),
    bridge: {
      activate: async () => { activations += 1; throw new Error("must not activate"); },
      invoke: async () => null,
      deactivate: async () => undefined,
      diagnostics: async () => ({ stderr: "", stderrTruncated: false, protocolDiagnostics: [] }),
      subscribe: async () => () => undefined,
      subscribeNotifications: async () => () => undefined,
    },
    marketplace: { listPluginInstallations: async () => installation() },
    locale: () => "en-US",
    reportError: (error) => { throw error; },
  });
  assert.deepEqual(await runtime.activate(identity, evidence, () => false), []);
  assert.equal(activations, 0);
  await runtime.dispose();
});
