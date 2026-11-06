import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { activeLanguageCatalogRegistrations } from "../src/application/language-services/catalog-registrations.ts";
import { LanguageCatalogIndex } from "../src/application/language-services/catalog-selection.ts";
import { PluginManagementRuntime } from "../src/application/plugins/plugin-management.ts";
import { PluginPreferenceStore, createSilentPluginPreferenceSync } from "../src/application/plugins/index.ts";

const catalog = JSON.parse(readFileSync(new URL("../protocol/fixtures/language-server-catalog.json", import.meta.url), "utf8")).valid[0].catalog;
const manifest = Object.freeze({ id: "dev.example.lsp", version: "1.0.0", nameKey: "name", descriptionKey: "description",
  localization: { defaultLocale: "en-US", locales: { "en-US": { name: "LSP", description: "Language tools", rust: "Rust", "server.rust": "Rust analyzer" } } },
  settings: [], languageServerCatalog: catalog });
const plugin = { id: manifest.id, version: manifest.version, origin: "bundled", manifest };
class MemoryStorage { getItem() { return null; } setItem() {} }
const context = { source: { kind: "editable-source", workspacePath: "src/main.rs" }, hasWorkspace: true,
  activePluginIds: new Set([manifest.id]), platform: "macos-arm64", rootMarkers: new Set(["Cargo.toml"]), rootMarkersComplete: true, preferredProvider: null };

test("only enabled and activated admitted catalogs become recommendation registrations", () => {
  const preferences = new PluginPreferenceStore(new MemoryStorage(), [manifest], createSilentPluginPreferenceSync());
  const management = new PluginManagementRuntime(preferences);
  management.setCatalog([plugin]);
  management.setMatched([manifest.id]);
  assert.deepEqual(activeLanguageCatalogRegistrations(management.snapshot), []);
  management.setActivation({ identity: { root: "/repo", generation: 1 }, activated: [manifest.id], skipped: [], diagnostics: [] });
  const registrations = activeLanguageCatalogRegistrations(management.snapshot);
  assert.equal(registrations.length, 1);
  assert.equal(new LanguageCatalogIndex(registrations).select(context).kind, "selected");
  assert.ok(Object.isFrozen(registrations));
  assert.ok(Object.isFrozen(registrations[0]));
  preferences.setEnabled(manifest.id, false);
  assert.deepEqual(activeLanguageCatalogRegistrations(management.snapshot), []);
  management.dispose(); preferences.dispose();
});

test("inactive installed manifests remain visible to settings without becoming language candidates", () => {
  const snapshot = { schemaVersion: 1, entries: [{ id: manifest.id, version: manifest.version, origin: "installed",
    nameKey: manifest.nameKey, descriptionKey: manifest.descriptionKey, localization: manifest.localization,
    enabled: true, matched: false, active: false, settingDescriptors: [], settings: {}, diagnostics: [], languageServerCatalog: catalog }] };
  assert.deepEqual(activeLanguageCatalogRegistrations(snapshot), []);
  snapshot.entries[0].active = true;
  assert.equal(activeLanguageCatalogRegistrations(snapshot).length, 1);
});
