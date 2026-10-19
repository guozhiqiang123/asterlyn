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
    pluginMarketplaceBridge: { listPluginInstallations: async () => installation("fixture") },
  });
  await runtime.activateWorkspace(identity);
  await runtime.updateWorkspaceEvidence(identity, evidence(["settings.gradle"]));
  assert.equal(bundledActivations, 0);
  assert.equal(runtime.contributionRegistry.get("fixture.tasks")?.pluginVersion, "1.0.0");
  assert.equal(providers[0].label, "External");
  assert.equal(runtime.managementSnapshot.entries[0].active, true);
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
    pluginMarketplaceBridge: { listPluginInstallations: async () => installation("fixture") },
  });
  await runtime.activateWorkspace(identity);
  await runtime.updateWorkspaceEvidence(identity, evidence(["settings.gradle"]));
  assert.equal(bundledActivations, 1);
  assert.equal(providers[0].label, "Bundled");
  assert.equal(errors.length, 1);
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
  };
}
