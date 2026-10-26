import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

test("plugin management revokes execution consent after disable/uninstall, preserving enable and failed-operation behavior", async () => {
  // The real binding uses TypeScript parameter properties; load it through the production TS transform.
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom" });
  try {
    const { PluginManagementBinding } = await server.ssrLoadModule("/src/features/settings/plugin-management-binding.ts");
    const revoked = [], errors = [], order = [];
    const host = { subscribePluginManagement: () => () => {}, loadPluginManagement: async () => { order.push("catalog"); return { schemaVersion: 1, entries: [] }; } };
    const binding = new PluginManagementBinding({}, host, {}, { visible: () => false, render() {}, reportError: (error) => errors.push(error.message), revokePluginExecution: (id) => { order.push("revoke"); revoked.push(id); } });
    try {
      const id = "dev.asterlyn.lsp";
      await binding.mutateInstallation(id, async () => ({ plugins: [{ pluginId: id, enabled: false }] }));
      assert.deepEqual(order.slice(0, 2), ["revoke", "catalog"], "consent is revoked before any asynchronous catalog reload");
      await binding.mutateInstallation(id, async () => ({ plugins: [{ pluginId: id, enabled: true }] }));
      assert.deepEqual(revoked, [id], "enabling cannot grant or revoke a decision by itself");
      await binding.mutateInstallation(id, async () => ({ plugins: [] }));
      await binding.mutateInstallation(id, async () => { throw Error("failed mutation"); });
      assert.deepEqual(revoked, [id, id]); assert.deepEqual(errors, ["failed mutation"]);
    } finally { binding.dispose(); }
  } finally { await server.close(); }
});
