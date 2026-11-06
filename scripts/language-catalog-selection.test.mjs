import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { catalogProviderKey, LanguageCatalogIndex, MAX_LANGUAGE_CATALOG_PLUGINS, MAX_CATALOG_DOCUMENT_PATH } from "../src/application/language-services/catalog-selection.ts";

const fixture = JSON.parse(readFileSync(new URL("../protocol/fixtures/language-server-catalog.json", import.meta.url), "utf8")).valid[0].catalog;
const pluginId = "dev.asterlyn.lsp";
const catalog = () => structuredClone(fixture);
const context = (path = "src/main.rs", overrides = {}) => ({
  source: { kind: "editable-source", workspacePath: path }, hasWorkspace: true, activePluginIds: new Set([pluginId]),
  platform: "macos-arm64", rootMarkers: new Set(["Cargo.toml"]), rootMarkersComplete: true, preferredProvider: null, ...overrides,
});
const index = (value = catalog()) => new LanguageCatalogIndex([{ pluginId, catalog: value }]);

test("selection is metadata only and does not grant installation or execution", () => {
  const result = index().select(context());
  assert.equal(result.kind, "selected");
  assert.equal(result.languageId, "rust");
  assert.equal(result.provider.key, catalogProviderKey(pluginId, "example-rust"));
  assert.deepEqual(Object.keys(result).sort(), ["kind", "languageId", "provider"]);
  assert.ok(Object.isFrozen(result.provider.server.upstream));
});

test("disabled/unavailable plugins and workspace transitions immediately remove candidates", () => {
  const compiled = index();
  assert.equal(compiled.select(context()).kind, "selected");
  assert.equal(compiled.select(context(undefined, { activePluginIds: new Set() })).kind, "inactive");
  assert.equal(compiled.select(context(undefined, { hasWorkspace: false })).kind, "inactive");
  assert.equal(compiled.select(context(undefined, { activePluginIds: new Set(["other.plugin"]) })).kind, "unknown-language");
  assert.equal(compiled.select(context("other.txt")).kind, "unknown-language");
});

test("read-only/history/dependency/image/absent sources never qualify", () => {
  for (const kind of ["read-only-source", "historical", "dependency", "other"]) assert.equal(index().select(context(undefined, { source: { workspacePath: "main.rs", kind } })).kind, "ineligible-document");
  assert.equal(index().select(context(undefined, { source: null })).kind, "ineligible-document");
});

test("selectors are case sensitive, support Unicode parent paths and reject malformed paths", () => {
  const compiled = index();
  assert.equal(compiled.select(context("模块/文件.rs")).kind, "selected");
  assert.equal(compiled.select(context("main.RS")).kind, "unknown-language");
  for (const path of ["", "/main.rs", "C:/main.rs", "../main.rs", "a/../main.rs", "a//main.rs", "a\\main.rs", "a/./main.rs", "a\n.rs", "a".repeat(MAX_CATALOG_DOCUMENT_PATH) + ".rs"]) assert.equal(compiled.select(context(path)).kind, "ineligible-document");
});

test("exact filename wins over the longest compound suffix, independent of declaration order", () => {
  const value = catalog();
  value.servers = [];
  value.languages = [
    { id: "typescript", labelKey: "ts", extensions: [".ts"], fileNames: [] },
    { id: "declaration", labelKey: "dts", extensions: [".d.ts"], fileNames: [] },
    { id: "special", labelKey: "special", extensions: [], fileNames: ["special.d.ts"] },
  ];
  for (const languages of [value.languages, [...value.languages].reverse()]) {
    const compiled = index({ ...value, languages });
    assert.equal(compiled.select(context("a.d.ts")).languageId, "declaration");
    assert.equal(compiled.select(context("a.ts")).languageId, "typescript");
    assert.equal(compiled.select(context("special.d.ts")).languageId, "special");
  }
});

test("equal-specificity conflicting languages fail closed while shared language identities coalesce", () => {
  const value = catalog();
  value.languages.push({ ...value.languages[0], id: "other" });
  assert.deepEqual(index(value).select(context()), { kind: "language-conflict", languageIds: ["other", "rust"] });
  const second = catalog(); second.servers = [];
  const compiled = new LanguageCatalogIndex([{ pluginId, catalog: catalog() }, { pluginId: "other.plugin", catalog: second }]);
  assert.equal(compiled.select(context(undefined, { activePluginIds: new Set([pluginId, "other.plugin"]) })).kind, "selected");
});

test("inactive more-specific selectors cannot hide active broader selectors", () => {
  const main = catalog(); main.languages[0].extensions = [".ts"];
  const other = catalog(); other.languages[0].extensions = [".d.ts"]; other.languages[0].id = "declaration"; other.servers = [];
  const compiled = new LanguageCatalogIndex([{ pluginId, catalog: main }, { pluginId: "other.plugin", catalog: other }]);
  assert.equal(compiled.select(context("a.d.ts")).languageId, "rust");
});

test("unselected upstreams and unsupported platforms remain distinct", () => {
  const value = catalog(); value.servers = [];
  assert.equal(index(value).select(context()).kind, "unconfigured");
  assert.equal(index().select(context(undefined, { platform: "windows-arm64" })).kind, "platform-unavailable");
});

test("root markers use positive bounded evidence and do not assume truncated absence", () => {
  const compiled = index();
  assert.equal(compiled.select(context(undefined, { rootMarkers: new Set() })).kind, "project-unmatched");
  assert.equal(compiled.select(context(undefined, { rootMarkers: new Set(), rootMarkersComplete: false })).kind, "project-unknown");
  assert.equal(compiled.select(context(undefined, { rootMarkersComplete: false })).kind, "selected");
  assert.equal(compiled.select(context(undefined, { rootMarkers: new Set(["nested/Cargo.toml"]) })).kind, "project-unmatched");
  const optional = catalog(); optional.servers[0].requireRootMarker = false;
  assert.equal(index(optional).select(context(undefined, { rootMarkers: new Set(), rootMarkersComplete: false })).kind, "selected");
});

test("competing providers require selection; missing preferences never silently fall back", () => {
  const value = catalog(); value.servers.push({ ...value.servers[0], id: "alternative" });
  const compiled = index(value);
  assert.equal(compiled.select(context()).kind, "provider-conflict");
  assert.equal(compiled.select(context(undefined, { preferredProvider: catalogProviderKey(pluginId, "alternative") })).provider.server.id, "alternative");
  assert.equal(compiled.select(context(undefined, { preferredProvider: catalogProviderKey(pluginId, "removed") })).kind, "preferred-unavailable");
});

test("incomplete evidence cannot silently choose an optional provider over an unknown competitor", () => {
  const value = catalog(); value.servers.push({ ...value.servers[0], id: "optional", requireRootMarker: false });
  const compiled = index(value);
  const unknown = context(undefined, { rootMarkers: new Set(), rootMarkersComplete: false });
  assert.equal(compiled.select(unknown).kind, "project-unknown");
  assert.equal(compiled.select({ ...unknown, preferredProvider: catalogProviderKey(pluginId, "optional") }).kind, "selected");
  assert.equal(compiled.select({ ...unknown, preferredProvider: catalogProviderKey(pluginId, "example-rust") }).kind, "project-unknown");
});

test("one server covers multiple languages with the same stable key", () => {
  const value = catalog(); value.languages.push({ id: "javascript", labelKey: "js", extensions: [".js", ".mjs", ".cjs"], fileNames: [] });
  value.servers[0].languageIds.push("javascript");
  const compiled = index(value);
  assert.equal(compiled.select(context("main.js")).provider.key, compiled.select(context()).provider.key);
});

test("compilation is bounded and detached from mutable caller input", () => {
  const value = catalog(); const compiled = index(value);
  value.languages[0].extensions[0] = ".changed"; value.servers[0].platforms.length = 0;
  assert.equal(compiled.select(context()).kind, "selected");
  assert.throws(() => new LanguageCatalogIndex(Array.from({ length: MAX_LANGUAGE_CATALOG_PLUGINS + 1 }, (_, i) => ({ pluginId: `example.p${i}`, catalog: catalog() }))));
  assert.throws(() => new LanguageCatalogIndex([{ pluginId, catalog: catalog() }, { pluginId, catalog: catalog() }]));
  assert.throws(() => new LanguageCatalogIndex([{ pluginId: `${pluginId}\n`, catalog: catalog() }]));
});
