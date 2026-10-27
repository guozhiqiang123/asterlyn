import assert from "node:assert/strict";
import test from "node:test";
import { pluginStartupIsHealthy } from "./verify-plugin-startup.mjs";

test("native startup acceptance waits beyond registration for the exact health checkpoint", () => {
  const expected = [{id: "dev.asterlyn.lsp", version: "0.2.1", digest: `sha256:${"a".repeat(64)}`}];
  const events = [{event: "application.frontend_ready"}, {event: "activation.completed", fields: {pluginId: expected[0].id, pluginVersion: "0.2.1"}}];
  const plugin = {pluginId: expected[0].id, enabled: true, activeVersion: "0.2.1", knownGoodVersion: "0.2.0", versions: [{version: "0.2.1", packageDigest: expected[0].digest, runtimeStatus: "active"}]};
  const installations = {plugins: [plugin]};
  assert.equal(pluginStartupIsHealthy(events, installations, expected), false);
  plugin.knownGoodVersion = "0.2.1"; plugin.versions[0].runtimeStatus = "knownGood";
  assert.equal(pluginStartupIsHealthy(events, installations, expected), true);
  assert.equal(pluginStartupIsHealthy(events.slice(1), installations, expected), false);
  assert.equal(pluginStartupIsHealthy(events.slice(0, 1), installations, expected), false);
  plugin.versions[0].runtimeStatus = "quarantined";
  assert.equal(pluginStartupIsHealthy(events, installations, expected), false);
  plugin.versions[0].runtimeStatus = "knownGood"; plugin.versions[0].packageDigest = `sha256:${"b".repeat(64)}`;
  assert.equal(pluginStartupIsHealthy(events, installations, expected), false);
});
