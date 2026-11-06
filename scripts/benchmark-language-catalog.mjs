import { performance } from "node:perf_hooks";
import { LanguageCatalogIndex, catalogProviderKey } from "../src/application/language-services/catalog-selection.ts";

if (!globalThis.gc) throw new Error("Run with node --expose-gc scripts/benchmark-language-catalog.mjs");
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const results = [];
for (const [name, pluginCount, languageCount, serverCount, suffixCount] of [
  ["single-manager", 1, 6, 4, 2], ["maximum-catalogs", 64, 16, 16, 16],
]) {
  const registrations = Array.from({ length: pluginCount }, (_, plugin) => ({
    pluginId: `example.plugin-${plugin}`, catalog: {
      schemaVersion: 1,
      languages: Array.from({ length: languageCount }, (_, language) => ({
        id: `lang-${language}`, labelKey: `language.${language}`,
        extensions: Array.from({ length: suffixCount }, (_, suffix) => `.l${language}.s${suffix}`), fileNames: [],
      })),
      servers: Array.from({ length: serverCount }, (_, server) => ({
        id: `server-${server}`, labelKey: `server.${server}`, languageIds: Array.from({ length: languageCount }, (_, language) => `lang-${language}`),
        upstream: { affiliation: "community", repository: "https://github.com/example/lsp" },
        platforms: ["macos-arm64", "macos-x64", "linux-arm64", "linux-x64", "windows-arm64", "windows-x64"],
        rootMarkers: ["marker"], requireRootMarker: true,
      })),
    },
  }));
  const context = { document: { kind: "editable-source", workspacePath: "src/file.l0.s0" }, hasWorkspace: true,
    activePluginIds: new Set(registrations.map(value => value.pluginId)), platform: "macos-arm64", rootMarkers: new Set(["marker"]), rootMarkersComplete: true, preferredProvider: null };
  const compile = [], queries = [], preferredQueries = [];
  let compiled;
  globalThis.gc();
  const before = process.memoryUsage().heapUsed;
  for (let iteration = 0; iteration < 3; ++iteration) {
    const began = performance.now(); compiled = new LanguageCatalogIndex(registrations); compile.push(performance.now() - began);
  }
  globalThis.gc();
  const retainedHeapBytes = process.memoryUsage().heapUsed - before;
  for (let iteration = 0; iteration < 1000; ++iteration) {
    let began = performance.now(); compiled.select(context); queries.push(performance.now() - began);
    began = performance.now(); compiled.select({ ...context, preferredProvider: catalogProviderKey("example.plugin-0", "server-0") }); preferredQueries.push(performance.now() - began);
  }
  const result = { name, pluginCount, languageCount, serverCount, compileMs: compile, queryP50Ms: percentile(queries, .5), queryP95Ms: percentile(queries, .95), preferredQueryP95Ms: percentile(preferredQueries, .95), retainedHeapBytes };
  // Foundation budgets for this deterministic synthetic corpus; not backend/app benchmarks.
  result.withinBudget = Math.max(...compile) <= 250 && result.queryP95Ms <= 5 && result.preferredQueryP95Ms <= 5 && retainedHeapBytes <= 16 * 1024 * 1024;
  results.push(result);
}
console.log(JSON.stringify({ schema: 1, node: process.version, platform: process.platform, arch: process.arch, results }, null, 2));
if (results.some(result => !result.withinBudget)) process.exitCode = 1;
