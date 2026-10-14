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
      return [{ id: "fixture", version: "1.0.0", matches: () => true, activate: () => { activations += 1; } }];
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
