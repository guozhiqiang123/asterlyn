import assert from "node:assert/strict";
import test from "node:test";
import { LanguageCatalogIndex } from "../src/application/language-services/catalog-selection.ts";
import { projectManagedLanguageStatus } from "../src/composition/managed-language-status-runtime.ts";
import { EN_US_LANGUAGE_SERVICE_COPY } from "../src/localization/language-service-copy.ts";

const localization = { defaultLocale: "en-US", locales: { "en-US": { "language.rust": "Rust", "server.rust": "rust-analyzer" } } };
const catalog = { schemaVersion: 1, languages: [{ id: "rust", labelKey: "language.rust", extensions: [".rs"], fileNames: [] }], servers: [] };
const entry = { id: "dev.example.lsp", version: "1.0.0", origin: "installed", nameKey: "name", descriptionKey: "description", localization,
  languageServerCatalog: catalog, enabled: true, matched: true, active: true, settingDescriptors: [], settings: {}, diagnostics: [] };
const snapshot = { schemaVersion: 1, entries: [entry] };
const environment = { protocolVersion: 1, platform: "macos-arm64", target: "aarch64-apple-darwin",
  installation: { protocolVersion: 1, epoch: "host-1", revision: 0, indexRevision: 0, artifacts: [], selections: [], operations: [] } };
const context = { source: { workspacePath: "src/main.rs", kind: "editable-source" }, hasWorkspace: true,
  rootMarkers: new Set(["Cargo.toml"]), rootMarkersComplete: true };

test("active catalog language without a chosen server recommends configuration", () => {
  const projection = projectManagedLanguageStatus(snapshot,
    new LanguageCatalogIndex([{ pluginId: entry.id, catalog }]), context, environment,
    { kind: "available", snapshot: environment.installation }, "en-US", EN_US_LANGUAGE_SERVICE_COPY.management);
  assert.equal(projection.selection.kind, "unconfigured");
  assert.equal(projection.presentation.visible, true);
  assert.equal(projection.presentation.text, "Rust language service is not configured");
  assert.deepEqual(projection.presentation.actions, ["open", "suppress", "dismiss"]);
  assert.equal(projection.pluginId, entry.id);
});

test("inactive plugin and non-editable documents never produce a recommendation", () => {
  const inactive = { schemaVersion: 1, entries: [{ ...entry, active: false }] };
  const inactiveProjection = projectManagedLanguageStatus(inactive, new LanguageCatalogIndex([]), context, environment,
    { kind: "available", snapshot: environment.installation }, "en-US", EN_US_LANGUAGE_SERVICE_COPY.management);
  assert.equal(inactiveProjection.presentation.visible, false);
  const readonlyProjection = projectManagedLanguageStatus(snapshot, new LanguageCatalogIndex([{ pluginId: entry.id, catalog }]),
    { ...context, source: { ...context.source, kind: "read-only-source" } }, environment,
    { kind: "available", snapshot: environment.installation }, "en-US", EN_US_LANGUAGE_SERVICE_COPY.management);
  assert.equal(readonlyProjection.presentation.visible, false);
});

test("selected server cannot expose install before a native recipe exists", () => {
  const configured = { ...catalog, servers: [{ id: "rust", labelKey: "server.rust", languageIds: ["rust"],
    upstream: { repository: "https://github.com/rust-lang/rust-analyzer", affiliation: "language-official" }, platforms: ["macos-arm64"], rootMarkers: ["Cargo.toml"], requireRootMarker: true }] };
  const configuredEntry = { ...entry, languageServerCatalog: configured };
  const configuredSnapshot = { schemaVersion: 1, entries: [configuredEntry] };
  const projection = projectManagedLanguageStatus(configuredSnapshot,
    new LanguageCatalogIndex([{ pluginId: entry.id, catalog: configured }]), context, environment,
    { kind: "available", snapshot: environment.installation }, "en-US", EN_US_LANGUAGE_SERVICE_COPY.management);
  assert.equal(projection.selection.kind, "selected");
  assert.equal(projection.presentation.state, "unavailable-recipe");
  assert.deepEqual(projection.presentation.actions, ["open", "suppress", "dismiss"]);
});
