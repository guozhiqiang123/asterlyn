import assert from "node:assert/strict";
import test from "node:test";

import { PluginContributionRegistry } from "../src/application/plugins/plugin-registry.ts";
import {
  ExternalPluginRuntime,
  INSTALLED_PLUGIN_ACTIVATION_EVIDENCE_LIMIT_BYTES,
  boundedRuntimeEvidence,
} from "../src/composition/external-plugin-runtime.ts";

const pluginId = "dev.asterlyn.fixture";
const identity = { root: "/repo", generation: 7 };
const evidence = {
  kind: "workspace-catalog",
  platform: "posix",
  files: [{ workspacePath: "settings.gradle.kts" }],
  truncated: false,
};

test("keeps a boostCleaner-sized workspace catalog complete for plugin activation", () => {
  const files = Array.from({ length: 7_086 }, (_, index) => ({
    workspacePath: `feature-${index}/src/main/java/com/example/boostcleaner/feature/cleanup/Feature${index}.kt`,
  }));
  const encoded = boundedRuntimeEvidence({ ...evidence, files });
  const encodedBytes = new TextEncoder().encode(JSON.stringify(encoded)).byteLength;
  assert.ok(encodedBytes > 512 * 1024, "fixture must exceed the former protocol ceiling");
  assert.ok(
    encodedBytes < INSTALLED_PLUGIN_ACTIVATION_EVIDENCE_LIMIT_BYTES,
  );
  assert.equal(encoded[0].values.truncated, false);
  assert.equal(encoded[0].values.files.length, files.length);
});

test("bounds oversized activation evidence and marks the catalog incomplete", () => {
  const files = Array.from({ length: 100 }, (_, index) => ({
    workspacePath: `模块-${index}/src/main/Feature-${index}.kt`,
  }));
  const maximumBytes = 512;
  const encoded = boundedRuntimeEvidence({ ...evidence, files }, maximumBytes);
  assert.ok(new TextEncoder().encode(JSON.stringify(encoded)).byteLength <= maximumBytes);
  assert.equal(encoded[0].values.truncated, true);
  assert.ok(encoded[0].values.files.length > 0);
  assert.ok(encoded[0].values.files.length < files.length);
});

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
  let selectedInstallation = installation();
  let eventListener = null;
  let notificationListener = null;
  let terminationListener = null;
  const bridge = {
    activate: async (...arguments_) => {
      calls.push(["activate", ...arguments_]);
      const selected = selectedInstallation.plugins[0];
      const version = selected.pendingVersion ?? selected.activeVersion;
      const admitted = selected.versions.find((candidate) => candidate.version === version);
      return {
        pluginId,
        pluginVersion: version,
        packageDigest: admitted.packageDigest,
        sessionId: `session-${version}`,
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
    confirmHealthy: async (activation) => { calls.push(["healthy", activation.sessionId]); return installation(); },
    failActivation: async (activation) => { calls.push(["failed", activation.sessionId]); return installation(); },
    abandonActivation: async (activation) => { calls.push(["abandoned", activation.sessionId]); return installation(); },
    diagnostics: async () => ({ stderr: "", stderrTruncated: false, protocolDiagnostics: [] }),
    subscribe: async (listener) => { eventListener = listener; return () => { eventListener = null; }; },
    subscribeNotifications: async (listener) => { notificationListener = listener; return () => { notificationListener = null; }; },
    subscribeTerminations: async (listener) => { terminationListener = listener; return () => { terminationListener = null; }; },
  };
  const notifications = [];
  const runtime = new ExternalPluginRuntime({
    registry,
    bridge,
    marketplace: { listPluginInstallations: async () => selectedInstallation },
    locale: () => "zh-CN",
    reportError: (error) => { throw error; },
    notification: (event) => { notifications.push(event); },
    healthCheckpointMs: 0,
  });

  assert.deepEqual(await runtime.activate(identity, evidence, () => true), [pluginId]);
  const command = registry.get(`${pluginId}.fixture-command`);
  assert.equal(command?.kind, "command");
  assert.equal(command.title(), "Fixture command");
  await command.execute();
  notificationListener({ pluginId, kind: "success", messageKey: "run.completed" });
  assert.deepEqual(notifications, [{ pluginId, kind: "success", messageKey: "run.completed" }]);
  assert.equal(typeof eventListener, "function");
  assert.equal(typeof terminationListener, "function");
  assert.deepEqual(calls[0].slice(0, 4), ["activate", pluginId, "/repo", 7]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.some((call) => call[0] === "healthy"), true);

  const changedEvidence = {
    ...evidence,
    files: [...evidence.files, { workspacePath: "generated/output.txt" }],
  };
  assert.deepEqual(await runtime.activate(identity, changedEvidence, () => true, true), [pluginId]);
  assert.equal(calls.filter((call) => call[0] === "activate").length, 1);
  assert.equal(calls.filter((call) => call[0] === "deactivate").length, 0);

  selectedInstallation = {
    ...selectedInstallation,
    generation: 2,
    plugins: [{
      ...selectedInstallation.plugins[0],
      pendingVersion: "1.2.4",
      versions: [...selectedInstallation.plugins[0].versions, {
        version: "1.2.4",
        packageDigest: `sha256:${"b".repeat(64)}`,
        admittedAtEpochMs: 2,
        runtimeStatus: "pendingRuntime",
      }],
    }],
  };
  assert.deepEqual(await runtime.activate(identity, changedEvidence, () => true, true), [pluginId]);
  assert.equal(calls.filter((call) => call[0] === "activate").length, 2);
  assert.equal(calls.filter((call) => call[0] === "deactivate").length, 1);

  await runtime.deactivate();
  assert.equal(registry.get(`${pluginId}.fixture-command`), null);
  assert.equal(calls.some((call) => call[0] === "deactivate"), true);
  await runtime.dispose();
});

test("workspace transition removes contributions and returns within its budget despite stale RPCs", async () => {
  const registry = new PluginContributionRegistry();
  const never = new Promise(() => undefined);
  const bridge = {
    activate: async () => ({
      pluginId,
      pluginVersion: "1.2.3",
      packageDigest: `sha256:${"a".repeat(64)}`,
      sessionId: "session-stale-rpc",
      contributions: [{
        kind: "command",
        id: "fixture-command",
        payload: {},
        callbacks: { title: "title", detail: "detail", execute: "execute" },
      }],
    }),
    invoke: async (_pluginId, handle) => {
      if (handle === "title") return "Fixture command";
      if (handle === "detail") return "Stale RPC fixture";
      if (handle === "execute") return never;
      throw new Error(`Unexpected callback: ${handle}`);
    },
    deactivate: async () => never,
    confirmHealthy: async () => installation(),
    failActivation: async () => installation(),
    abandonActivation: async () => installation(),
    diagnostics: async () => ({ stderr: "", stderrTruncated: false, protocolDiagnostics: [] }),
    subscribe: async () => () => undefined,
    subscribeNotifications: async () => () => undefined,
    subscribeTerminations: async () => () => undefined,
  };
  const runtime = new ExternalPluginRuntime({
    registry,
    bridge,
    marketplace: { listPluginInstallations: async () => installation() },
    locale: () => "en-US",
    reportError: (error) => { throw error; },
    healthCheckpointMs: 0,
    transitionStopTimeoutMs: 20,
  });
  await runtime.activate(identity, evidence, () => true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const command = registry.get(`${pluginId}.fixture-command`);
  void command.execute();

  const started = Date.now();
  const stopped = runtime.deactivate();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(registry.get(`${pluginId}.fixture-command`), null);
  await stopped;
  assert.ok(Date.now() - started < 200, "deactivation exceeded the host transition budget");
  await runtime.dispose();
});

test("exact native termination aborts the session and removes its complete contribution batch", async () => {
  const registry = new PluginContributionRegistry();
  const calls = [];
  const incidents = [];
  let terminationListener = null;
  const activation = {
    pluginId,
    pluginVersion: "1.2.3",
    packageDigest: `sha256:${"a".repeat(64)}`,
    sessionId: "session-crashed",
    contributions: [{
      kind: "command",
      id: "fixture-command",
      payload: {},
      callbacks: { title: "title", detail: "detail", execute: "execute" },
    }],
  };
  const bridge = {
    activate: async () => activation,
    invoke: async (_pluginId, handle) => {
      if (handle === "title") return "Fixture command";
      if (handle === "detail") return "Crash fixture";
      if (handle === "execute") return new Promise(() => undefined);
      throw new Error(`Unexpected callback: ${handle}`);
    },
    deactivate: async () => undefined,
    confirmHealthy: async () => installation(),
    failActivation: async (failed) => { calls.push(["failed", failed.sessionId]); return installation(); },
    abandonActivation: async () => installation(),
    diagnostics: async () => ({ stderr: "", stderrTruncated: false, protocolDiagnostics: [] }),
    subscribe: async () => () => undefined,
    subscribeNotifications: async () => () => undefined,
    subscribeTerminations: async (listener) => { terminationListener = listener; return () => undefined; },
  };
  const runtime = new ExternalPluginRuntime({
    registry,
    bridge,
    marketplace: { listPluginInstallations: async () => installation() },
    locale: () => "en-US",
    reportError: (error) => { throw error; },
    terminated: (event) => { incidents.push(event); },
    healthCheckpointMs: 60_000,
  });
  await runtime.activate(identity, evidence, () => true);
  const command = registry.get(`${pluginId}.fixture-command`);
  assert.notEqual(command, null);
  void command.execute();
  const termination = {
    owner: "main",
    pluginId,
    pluginVersion: "1.2.3",
    packageDigest: `sha256:${"a".repeat(64)}`,
    sessionId: "session-crashed",
    reason: "unexpectedExit",
    detail: "plugin helper exited with status 17",
    recoveryPersisted: true,
    diagnostics: { stderr: "fixture crash", stderrTruncated: false, protocolDiagnostics: [] },
  };
  terminationListener({ ...termination, sessionId: "stale-session" });
  assert.notEqual(registry.get(`${pluginId}.fixture-command`), null);

  terminationListener(termination);
  assert.equal(registry.get(`${pluginId}.fixture-command`), null);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, [["failed", "session-crashed"]]);
  assert.deepEqual(incidents, [termination]);
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
    confirmHealthy: async () => installation(),
    failActivation: async () => installation(),
    abandonActivation: async () => installation(),
    diagnostics: async () => ({ stderr: "", stderrTruncated: false, protocolDiagnostics: [] }),
    subscribe: async (listener) => { runtimeEvent = listener; return () => undefined; },
    subscribeNotifications: async () => () => undefined,
    subscribeTerminations: async () => () => undefined,
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

test("uses the host task hierarchy when a remote custom collection would duplicate a large snapshot", async () => {
  const registry = new PluginContributionRegistry();
  const calls = [];
  const tasks = Array.from({ length: 4_097 }, (_, index) => ({
    id: `:app:task${index}`,
    label: `:app:task${index}`,
    group: "Other tasks",
    projectPath: ":app",
    runnable: false,
  }));
  const runtime = new ExternalPluginRuntime({
    registry,
    bridge: {
      activate: async () => ({
        pluginId,
        pluginVersion: "1.2.3",
        packageDigest: `sha256:${"a".repeat(64)}`,
        sessionId: "session-large-collection",
        contributions: [{
          kind: "taskProvider",
          id: "tasks",
          payload: { label: "Fixture" },
          callbacks: { snapshot: "snapshot", collections: "collections" },
        }],
      }),
      invoke: async (_pluginId, handle) => {
        calls.push(handle);
        if (handle === "snapshot") return { status: "ready", tasks };
        if (handle === "collections") throw new Error("large custom collection must be skipped");
        throw new Error(`Unexpected callback: ${handle}`);
      },
      deactivate: async () => undefined,
      confirmHealthy: async () => installation(),
      failActivation: async () => installation(),
      abandonActivation: async () => installation(),
      diagnostics: async () => ({ stderr: "", stderrTruncated: false, protocolDiagnostics: [] }),
      subscribe: async () => () => undefined,
      subscribeNotifications: async () => () => undefined,
      subscribeTerminations: async () => () => undefined,
    },
    marketplace: { listPluginInstallations: async () => installation() },
    locale: () => "en-US",
    reportError: (error) => { throw error; },
  });

  assert.deepEqual(await runtime.activate(identity, evidence, () => true), [pluginId]);
  const provider = registry.get(`${pluginId}.tasks`);
  assert.equal(provider.snapshot().tasks.length, 4_097);
  assert.deepEqual(provider.collections(), []);
  assert.deepEqual(calls, ["snapshot"]);
  await runtime.dispose();
});

test("skips disabled installations before starting a process", async () => {
  let activations = 0;
  const runtime = new ExternalPluginRuntime({
    registry: new PluginContributionRegistry(),
    bridge: {
      activate: async () => { activations += 1; throw new Error("must not activate"); },
      invoke: async () => null,
      deactivate: async () => undefined,
      confirmHealthy: async () => installation(),
      failActivation: async () => installation(),
      abandonActivation: async () => installation(),
      diagnostics: async () => ({ stderr: "", stderrTruncated: false, protocolDiagnostics: [] }),
      subscribe: async () => () => undefined,
      subscribeNotifications: async () => () => undefined,
      subscribeTerminations: async () => () => undefined,
    },
    marketplace: { listPluginInstallations: async () => installation() },
    locale: () => "en-US",
    reportError: (error) => { throw error; },
  });
  assert.deepEqual(await runtime.activate(identity, evidence, () => false), []);
  assert.equal(activations, 0);
  await runtime.dispose();
});

test("quarantines an activation whose projected contribution violates the host contract", async () => {
  const registry = new PluginContributionRegistry();
  const calls = [];
  const errors = [];
  const activation = {
    pluginId,
    pluginVersion: "1.2.3",
    packageDigest: `sha256:${"a".repeat(64)}`,
    sessionId: "session-invalid",
    contributions: [{
      kind: "command",
      id: "invalid-command",
      payload: {},
      callbacks: { title: "title", detail: "detail", execute: "execute" },
    }],
  };
  const runtime = new ExternalPluginRuntime({
    registry,
    bridge: {
      activate: async () => activation,
      invoke: async (_pluginId, handle) => {
        if (handle === "title") return "";
        if (handle === "detail") return "Invalid contribution";
        return null;
      },
      deactivate: async (id) => { calls.push(["deactivate", id]); },
      confirmHealthy: async () => installation(),
      failActivation: async (failed) => {
        calls.push(["failed", failed.sessionId]);
        return installation();
      },
      abandonActivation: async (abandoned) => {
        calls.push(["abandoned", abandoned.sessionId]);
        return installation();
      },
      diagnostics: async () => ({ stderr: "", stderrTruncated: false, protocolDiagnostics: [] }),
      subscribe: async () => () => undefined,
      subscribeNotifications: async () => () => undefined,
      subscribeTerminations: async () => () => undefined,
    },
    marketplace: { listPluginInstallations: async () => installation() },
    locale: () => "en-US",
    reportError: (error) => { errors.push(error); },
    healthCheckpointMs: 0,
  });

  assert.deepEqual(await runtime.activate(identity, evidence, () => true), []);
  assert.equal(registry.get(`${pluginId}.invalid-command`), null);
  assert.deepEqual(calls, [
    ["failed", "session-invalid"],
    ["deactivate", pluginId],
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /bounded non-empty text/u);
  await runtime.dispose();
});
