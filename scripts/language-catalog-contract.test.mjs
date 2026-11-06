import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { freezeLanguageServerCatalog, validateLanguageServerCatalog } from "../src/application/plugins/language-catalog-contract.ts";
import { adaptPluginManifest } from "../src/application/plugins/plugin-sdk-adapter.ts";

const corpus = JSON.parse(readFileSync(new URL("../protocol/fixtures/language-server-catalog.json", import.meta.url), "utf8"));
for (const { name, catalog } of corpus.valid) test(`catalog accepts: ${name}`, () => assert.doesNotThrow(() => validateLanguageServerCatalog(catalog)));
for (const { name, catalog } of corpus.invalid) test(`catalog rejects: ${name}`, () => assert.throws(() => validateLanguageServerCatalog(catalog), /Invalid language server catalog/u));

test("manifest adaptation retains detached, deeply immutable metadata and requires localized labels", () => {
  const catalog = structuredClone(corpus.valid[0].catalog);
  const manifest = { sdkMajor: 1, id: "example.plugin", version: "1.0.0", nameKey: "name", descriptionKey: "description", settings: [],
    localization: { defaultLocale: "en-US", locales: { "en-US": { name: "Name", description: "Description", "language.rust": "Rust", "server.rust": "Example" } } },
    languageServerCatalog: catalog,
  };
  const admitted = adaptPluginManifest(manifest).languageServerCatalog;
  assert.deepEqual(admitted, catalog);
  assert.ok(Object.isFrozen(admitted.servers[0].upstream));
  assert.ok(Object.isFrozen(admitted.servers[0].platforms));
  assert.ok(Object.isFrozen(admitted.languages[0].extensions));
  catalog.languages[0].extensions.push(".changed");
  assert.deepEqual(admitted.languages[0].extensions, [".rs"]);
  delete manifest.localization.locales["en-US"]["server.rust"];
  assert.throws(() => adaptPluginManifest(manifest), /missing default message/u);
});

test("catalog metadata cannot smuggle installation or execution fields", () => {
  const catalog = structuredClone(corpus.valid[0].catalog);
  for (const field of ["install", "command", "args", "environment", "executable", "downloadUrl", "installed", "approved"]) {
    assert.throws(() => freezeLanguageServerCatalog({ ...catalog, [field]: true }));
    assert.throws(() => freezeLanguageServerCatalog({ ...catalog, servers: [{ ...catalog.servers[0], [field]: true }] }));
  }
});
