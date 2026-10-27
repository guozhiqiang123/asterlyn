import assert from "node:assert/strict";
import test from "node:test";

import { PluginCompositionRuntime } from "../src/composition/plugin-runtime.ts";

const identity = { root: "/repo", generation: 1 };
const evidence = (paths) => ({
  kind: "workspace-catalog", platform: "posix", truncated: false,
  files: paths.map((workspacePath) => ({ workspacePath })),
});

test("composition lazily loads plugins, deduplicates evidence, and rejects stale workspaces", async () => {
  let loads = 0;
  let activations = 0;
  const providers = [];
  const runtime = new PluginCompositionRuntime({
    registerCommand: () => () => undefined,
    replaceProviders: (_identity, next) => providers.push(next),
    reportDiagnostic: () => undefined,
    reportError: (error) => { throw error; },
    loadPlugins: async () => {
      loads += 1;
      return [fixturePlugin("fixture", () => { activations += 1; })];
    },
  });
  await runtime.activateWorkspace(identity);
  assert.equal(loads, 0);
  await runtime.updateWorkspaceEvidence(identity, evidence(["settings.gradle"]));
  await runtime.updateWorkspaceEvidence(identity, evidence(["settings.gradle"]));
  await runtime.updateWorkspaceEvidence({ root: "/stale", generation: 2 }, evidence(["settings.gradle"]));
  assert.equal(loads, 1);
  assert.equal(activations, 1);
  assert.deepEqual(providers.at(-1), []);
  runtime.dispose();
});

test("concurrent matching evidence updates share one isolated plugin activation", async () => {
  let activations = 0;
  let releaseActivation;
  let markActivationStarted;
  const activationStarted = new Promise((resolve) => { markActivationStarted = resolve; });
  const activationGate = new Promise((resolve) => { releaseActivation = resolve; });
  const activation = {
    pluginId: "fixture",
    pluginVersion: "1.0.0",
    packageDigest: `sha256:${"a".repeat(64)}`,
    sessionId: "external-session",
    contributions: [{
      kind: "taskProvider", id: "tasks", payload: { label: "External" },
      callbacks: { snapshot: "snapshot" },
    }],
  };
  const bridge = externalBridge(activation);
  bridge.activate = async () => {
    activations += 1;
    markActivationStarted();
    await activationGate;
    return { ...activation, sessionId: `external-session-${activations}` };
  };
  const runtime = new PluginCompositionRuntime({
    registerCommand: () => () => undefined,
    replaceProviders: () => undefined,
    reportDiagnostic: () => undefined,
    reportError: (error) => { throw error; },
    installedPluginRuntimeBridge: bridge,
    pluginMarketplaceBridge: marketplace("fixture"),
  });
  await runtime.activateWorkspace(identity);
  const first = runtime.updateWorkspaceEvidence(identity, evidence(["settings.gradle"]));
  await activationStarted;
  const second = runtime.updateWorkspaceEvidence(identity, evidence(["settings.gradle"]));
  releaseActivation();
  await Promise.all([first, second]);
  assert.equal(activations, 1);
  runtime.dispose();
});

test("plugin-scoped evidence keys preserve activation across unrelated generated files", async () => {
  let activations = 0;
  const runtime = new PluginCompositionRuntime({
    registerCommand: () => () => undefined,
    replaceProviders: () => undefined,
    reportDiagnostic: () => undefined,
    reportError: (error) => { throw error; },
    loadPlugins: async () => [fixturePlugin("fixture", () => { activations += 1; }, ({ evidence: snapshot }) => JSON.stringify(snapshot.files.filter((file) => file.workspacePath === "settings.gradle")))],
  });
  await runtime.activateWorkspace(identity);
  await runtime.updateWorkspaceEvidence(identity, evidence(["settings.gradle"]));
  await runtime.updateWorkspaceEvidence(identity, evidence(["settings.gradle", "app/build/outputs/app.apk"]));
  assert.equal(activations, 1);
  runtime.dispose();
});

test("installed plugin contributions replace the matching bundled fallback", async () => {
  let bundledActivations = 0;
  let providers = [];
  const plugin = fixturePlugin("fixture", (context) => {
    bundledActivations += 1;
    context.contribute({
      kind: "provider", id: "tasks", label: "Bundled",
      snapshot: () => ({ status: "ready", tasks: [] }),
    });
  });
  const bridge = externalBridge({
    pluginId: "fixture",
    pluginVersion: "1.0.0",
    packageDigest: `sha256:${"a".repeat(64)}`,
    sessionId: "external-session",
    contributions: [{
      kind: "taskProvider", id: "tasks", payload: { label: "External" },
      callbacks: { snapshot: "snapshot" },
    }],
  });
  const runtime = new PluginCompositionRuntime({
    registerCommand: () => () => undefined,
    replaceProviders: (_identity, next) => { providers = [...next]; },
    reportDiagnostic: () => undefined,
    reportError: (error) => { throw error; },
    loadPlugins: async () => [plugin],
    installedPluginRuntimeBridge: bridge,
    pluginMarketplaceBridge: marketplace("fixture"),
  });
  await runtime.activateWorkspace(identity);
  await runtime.updateWorkspaceEvidence(identity, evidence(["settings.gradle"]));
  assert.equal(bundledActivations, 0);
  assert.equal(runtime.contributionRegistry.get("fixture.tasks")?.pluginVersion, "1.0.0");
  assert.equal(providers[0].label, "External");
  assert.equal(runtime.managementSnapshot.entries[0].active, true);
  runtime.dispose();
});

test("the production default preserves a healthy isolated package across catalog evidence", async () => {
  let activations = 0;
  const activation = {
    pluginId: "fixture",
    pluginVersion: "1.0.0",
    packageDigest: `sha256:${"a".repeat(64)}`,
    sessionId: "external-session",
    contributions: [{
      kind: "taskProvider", id: "tasks", payload: { label: "External" },
      callbacks: { snapshot: "snapshot" },
    }],
  };
  const bridge = externalBridge(activation);
  bridge.activate = async () => {
    activations += 1;
    return { ...activation, sessionId: `external-session-${activations}` };
  };
  const manifest = {
    sdkMajor: 1, id: "fixture", version: "1.0.0", nameKey: "name", descriptionKey: "description",
    localization: { defaultLocale: "en-US", locales: { "en-US": { name: "Fixture", description: "Fixture plugin" } } },
    settings: [],
  };
  const runtime = new PluginCompositionRuntime({
    registerCommand: () => () => undefined,
    replaceProviders: () => undefined,
    reportDiagnostic: () => undefined,
    reportError: (error) => { throw error; },
    installedPluginRuntimeBridge: bridge,
    pluginMarketplaceBridge: {
      listPluginInstallations: async () => installation("fixture"),
      listInstalledPluginManifests: async () => ({
        schemaVersion: 1,
        generation: 1,
        manifests: [{ pluginId: "fixture", pluginVersion: "1.0.0", packageDigest: activation.packageDigest, manifest, error: null }],
      }),
    },
  });
  await runtime.activateWorkspace(identity);
  await runtime.updateWorkspaceEvidence(identity, evidence(["settings.gradle"]));
  await runtime.updateWorkspaceEvidence(identity, evidence(["settings.gradle", "app/build.gradle"]));
  assert.equal(activations, 1);
  assert.equal(runtime.managementSnapshot.entries[0]?.matched, true);
  assert.equal(runtime.managementSnapshot.entries[0]?.active, true);
  runtime.dispose();
});

test("failed installed plugin activation falls back to bundled contributions", async () => {
  let bundledActivations = 0;
  let providers = [];
  const errors = [];
  const plugin = fixturePlugin("fixture", (context) => {
    bundledActivations += 1;
    context.contribute({
      kind: "provider", id: "tasks", label: "Bundled",
      snapshot: () => ({ status: "ready", tasks: [] }),
    });
  });
  const bridge = externalBridge(null);
  bridge.activate = async () => { throw new Error("isolated runtime failed"); };
  const runtime = new PluginCompositionRuntime({
    registerCommand: () => () => undefined,
    replaceProviders: (_identity, next) => { providers = [...next]; },
    reportDiagnostic: () => undefined,
    reportError: (error) => { errors.push(error); },
    loadPlugins: async () => [plugin],
    installedPluginRuntimeBridge: bridge,
    pluginMarketplaceBridge: marketplace("fixture"),
  });
  await runtime.activateWorkspace(identity);
  await runtime.updateWorkspaceEvidence(identity, evidence(["settings.gradle"]));
  assert.equal(bundledActivations, 1);
  assert.equal(providers[0].label, "Bundled");
  assert.equal(errors.length, 1);
  runtime.dispose();
});

test("a persisted healthy-runtime crash reconciles once to the selected known-good fallback", async () => {
  let terminationListener;
  let activationCount = 0;
  let currentInstallations = crashInstallation(false);
  const bridge = externalBridge(null);
  bridge.activate = async () => {
    activationCount += 1;
    const fallback = activationCount > 1;
    return {
      pluginId: "fixture",
      pluginVersion: fallback ? "1.0.0" : "2.0.0",
      packageDigest: `sha256:${(fallback ? "a" : "b").repeat(64)}`,
      sessionId: fallback ? "fallback-session" : "crashed-session",
      contributions: [{
        kind: "taskProvider", id: "tasks", payload: { label: fallback ? "Fallback" : "Current" },
        callbacks: { snapshot: "snapshot" },
      }],
    };
  };
  bridge.subscribeTerminations = async (listener) => {
    terminationListener = listener;
    return () => undefined;
  };
  bridge.confirmHealthy = async () => currentInstallations;
  bridge.failActivation = async () => currentInstallations;
  const runtime = new PluginCompositionRuntime({
    registerCommand: () => () => undefined,
    replaceProviders: () => undefined,
    reportDiagnostic: () => undefined,
    reportError: (error) => { throw error; },
    loadPlugins: async () => [fixturePlugin("fixture", () => undefined)],
    installedPluginRuntimeBridge: bridge,
    pluginMarketplaceBridge: {
      listPluginInstallations: async () => currentInstallations,
      listInstalledPluginManifests: async () => ({ schemaVersion: 1, generation: 1, manifests: [] }),
    },
    installedPluginHealthCheckpointMs: 0,
  });
  await runtime.activateWorkspace(identity);
  await runtime.updateWorkspaceEvidence(identity, evidence(["settings.gradle"]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runtime.contributionRegistry.get("fixture.tasks")?.pluginVersion, "2.0.0");

  currentInstallations = crashInstallation(true);
  terminationListener({
    owner: "main", pluginId: "fixture", pluginVersion: "2.0.0",
    packageDigest: `sha256:${"b".repeat(64)}`, sessionId: "crashed-session",
    reason: "unexpectedExit", detail: "fixture crash", recoveryPersisted: true,
    diagnostics: { stderr: "", stderrTruncated: false, protocolDiagnostics: [] },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(activationCount, 2);
  assert.equal(runtime.contributionRegistry.get("fixture.tasks")?.pluginVersion, "1.0.0");
  runtime.dispose();
});

test("recovery persistence failure leaves the crashed plugin stopped instead of hot-restarting it", async () => {
  let terminationListener;
  let activationCount = 0;
  const installations = crashInstallation(false);
  const bridge = externalBridge(null);
  bridge.activate = async () => {
    activationCount += 1;
    return {
      pluginId: "fixture", pluginVersion: "2.0.0",
      packageDigest: `sha256:${"b".repeat(64)}`, sessionId: "crashed-session",
      contributions: [{ kind: "taskProvider", id: "tasks", payload: { label: "Current" }, callbacks: { snapshot: "snapshot" } }],
    };
  };
  bridge.subscribeTerminations = async (listener) => { terminationListener = listener; return () => undefined; };
  const runtime = new PluginCompositionRuntime({
    registerCommand: () => () => undefined,
    replaceProviders: () => undefined,
    reportDiagnostic: () => undefined,
    reportError: (error) => { throw error; },
    loadPlugins: async () => [fixturePlugin("fixture", () => undefined)],
    installedPluginRuntimeBridge: bridge,
    pluginMarketplaceBridge: {
      listPluginInstallations: async () => installations,
      listInstalledPluginManifests: async () => ({ schemaVersion: 1, generation: 1, manifests: [] }),
    },
    installedPluginHealthCheckpointMs: 0,
  });
  await runtime.activateWorkspace(identity);
  await runtime.updateWorkspaceEvidence(identity, evidence(["settings.gradle"]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  terminationListener({
    owner: "main", pluginId: "fixture", pluginVersion: "2.0.0",
    packageDigest: `sha256:${"b".repeat(64)}`, sessionId: "crashed-session",
    reason: "unexpectedExit", detail: "fixture crash", recoveryPersisted: false,
    diagnostics: { stderr: "", stderrTruncated: false, protocolDiagnostics: [] },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(activationCount, 1);
  assert.equal(runtime.contributionRegistry.get("fixture.tasks"), null);
  runtime.dispose();
});

test("installed plugin notifications resolve only through the admitted external manifest", async () => {
  let notifications;
  const published = [];
  const activation = {
    pluginId: "fixture.external",
    pluginVersion: "1.0.0",
    packageDigest: `sha256:${"a".repeat(64)}`,
    sessionId: "external-session",
    contributions: [{
      kind: "taskProvider", id: "tasks", payload: { label: "External" },
      callbacks: { snapshot: "snapshot" },
    }],
  };
  const bridge = externalBridge(activation);
  bridge.subscribeNotifications = async (listener) => {
    notifications = listener;
    return () => undefined;
  };
  bridge.subscribeTerminations = async () => () => undefined;
  const manifest = {
    sdkMajor: 1,
    id: "fixture.external",
    version: "1.0.0",
    nameKey: "name",
    descriptionKey: "description",
    localization: { defaultLocale: "en-US", locales: { "en-US": {
      name: "External",
      description: "External plugin",
      notice: "External operation completed.",
    } } },
    settings: [],
    processQueries: [{
      id: "fixture.query", args: [], timeoutMs: 1_000, maxOutputBytes: 1_024,
      executables: [{ type: "path", name: "fixture-tool" }],
    }],
    toolOperations: [{
      id: "fixture.operation", intent: "query", args: [], parameters: [],
      timeoutMs: 1_000, maxOutputBytes: 1_024,
      executables: [{ type: "path", name: "fixture-tool" }],
    }],
  };
  const runtime = new PluginCompositionRuntime({
    registerCommand: () => () => undefined,
    replaceProviders: () => undefined,
    reportDiagnostic: () => undefined,
    reportError: (error) => { throw error; },
    loadPlugins: async () => [],
    installedPluginRuntimeBridge: bridge,
    pluginMarketplaceBridge: {
      listPluginInstallations: async () => installation("fixture.external"),
      listInstalledPluginManifests: async () => ({
        schemaVersion: 1,
        generation: 1,
        manifests: [{ pluginId: manifest.id, pluginVersion: manifest.version, packageDigest: activation.packageDigest, manifest, error: null }],
      }),
    },
    notificationPublisher: { publish: (notification) => { published.push(notification); } },
  });
  await runtime.activateWorkspace(identity);
  await runtime.updateWorkspaceEvidence(identity, evidence(["settings.gradle"]));
  const admitted = await runtime.plugin("fixture.external");
  assert.equal(admitted?.origin, "installed");
  assert.equal(admitted?.manifest.processQueries?.[0]?.id, "fixture.query");
  assert.equal(admitted?.manifest.toolOperations?.[0]?.id, "fixture.operation");
  notifications({ pluginId: "fixture.external", kind: "success", messageKey: "notice" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(published, [{ kind: "success", message: "External operation completed.", source: "plugin:fixture.external" }]);
  runtime.dispose();
});

function fixturePlugin(id, activate, evidenceKey) {
  return {
    id,
    version: "1.0.0",
    manifest: {
      id,
      version: "1.0.0",
      nameKey: "name",
      descriptionKey: "description",
      localization: { defaultLocale: "en-US", locales: { "en-US": { name: id, description: `${id} description` } } },
      settings: [],
    },
    matches: () => true,
    ...(evidenceKey ? { evidenceKey } : {}),
    activate,
  };
}

function installation(pluginId) {
  return {
    schemaVersion: 1, generation: 1, recovered: false,
    plugins: [{
      pluginId, repository: "asterlyn/plugin-fixture", enabled: true, bundledFallback: true,
      activeVersion: null, knownGoodVersion: null, pendingVersion: "1.0.0",
      versions: [{
        version: "1.0.0", packageDigest: `sha256:${"a".repeat(64)}`,
        admittedAtEpochMs: 1, runtimeStatus: "pendingRuntime",
      }],
    }],
  };
}

function crashInstallation(crashed) {
  return {
    schemaVersion: 2, generation: crashed ? 2 : 1, recovered: false,
    plugins: [{
      pluginId: "fixture", repository: "asterlyn/plugin-fixture", enabled: true, bundledFallback: true,
      activeVersion: crashed ? "1.0.0" : "2.0.0", knownGoodVersion: crashed ? "1.0.0" : "2.0.0", pendingVersion: null,
      versions: [
        { version: "1.0.0", packageDigest: `sha256:${"a".repeat(64)}`, contentDigest: `sha256:${"c".repeat(64)}`, admittedAtEpochMs: 1, runtimeStatus: "knownGood" },
        { version: "2.0.0", packageDigest: `sha256:${"b".repeat(64)}`, contentDigest: `sha256:${"d".repeat(64)}`, admittedAtEpochMs: 2, runtimeStatus: crashed ? "quarantined" : "knownGood" },
      ],
    }],
  };
}

function marketplace(pluginId) {
  return {
    listPluginInstallations: async () => installation(pluginId),
    listInstalledPluginManifests: async () => ({ schemaVersion: 1, generation: 1, manifests: [] }),
  };
}

function externalBridge(activation) {
  return {
    activate: async () => activation,
    confirmHealthy: async () => installation(activation?.pluginId ?? "fixture"),
    failActivation: async () => installation(activation?.pluginId ?? "fixture"),
    abandonActivation: async () => installation(activation?.pluginId ?? "fixture"),
    invoke: async (_pluginId, handle) => {
      if (handle === "snapshot") return { status: "ready", tasks: [] };
      throw new Error(`Unexpected external callback: ${handle}`);
    },
    deactivate: async () => undefined,
    diagnostics: async () => ({ stderr: "", stderrTruncated: false, protocolDiagnostics: [] }),
    subscribe: async () => () => undefined,
    subscribeNotifications: async () => () => undefined,
    subscribeTerminations: async () => () => undefined,
  };
}


test("native installation changes reconcile other windows without reactivating healthy peers", async () => {
  let changed;
  let released = false;
  let enabled = true;
  let activations = 0;
  const errors = [];
  const providers = [];
  const activation = { pluginId: "fixture", pluginVersion: "1.0.0", packageDigest: `sha256:${"a".repeat(64)}`,
    sessionId: "external-session", contributions: [{kind: "taskProvider", id: "tasks", payload: {label: "External"}, callbacks: {snapshot: "snapshot"}}] };
  const bridge = externalBridge(activation);
  bridge.activate = async () => { activations += 1; return activation; };
  const store = marketplace("fixture");
  const manifest = { sdkMajor: 1, ...fixturePlugin("fixture", () => {}).manifest };
  store.listInstalledPluginManifests = async () => ({schemaVersion: 1, generation: 1, manifests: [{pluginId: "fixture", pluginVersion: "1.0.0", packageDigest: activation.packageDigest, manifest, error: null}]});
  store.subscribeInstallations = async (listener) => { changed = listener; return () => { released = true; }; };
  store.listPluginInstallations = async () => { const snapshot = installation("fixture"); snapshot.plugins[0].enabled = enabled; return snapshot; };
  const runtime = new PluginCompositionRuntime({ registerCommand: () => () => {}, replaceProviders: (_identity, value) => { providers.push(value); },
    reportDiagnostic: () => {}, reportError: (error) => errors.push(error), installedPluginRuntimeBridge: bridge, pluginMarketplaceBridge: store });
  await runtime.activateWorkspace(identity);
  await runtime.updateWorkspaceEvidence(identity, evidence(["settings.gradle"]));
  assert.equal(activations, 1);
  assert.equal(runtime.managementSnapshot.entries[0].enabled, true);
  changed();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(activations, 1, "unrelated global change preserves a healthy isolated runtime");
  enabled = false;
  changed();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.contributionRegistry.get("fixture.tasks"), null);
  assert.deepEqual(providers.at(-1), []);
  assert.equal(runtime.managementSnapshot.entries[0].enabled, false, "installed management status uses native enablement rather than local preferences");
  enabled = true;
  changed();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(activations, 2);
  assert.equal(errors.length, 0);
  runtime.dispose();
  assert.equal(released, true);
});
