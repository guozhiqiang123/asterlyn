import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { ManagedInstallationFacts } from "../src/application/language-services/installation-facts.ts";
import { recommendManagedInstallation } from "../src/application/language-services/installation-recommendation.ts";
import { LanguageCatalogIndex } from "../src/application/language-services/catalog-selection.ts";

assert.equal(typeof global.gc, "function", "Run with node --expose-gc");
const fixture = JSON.parse(readFileSync(new URL("../protocol/fixtures/managed-language-installation.json", import.meta.url), "utf8")).base;
const snapshot = { ...fixture, artifacts: [], selections: [], operations: [] };
for (let n = 0; n < 64; n++) {
  const item = structuredClone(fixture.artifacts[0]);
  item.artifact.identity.server.serverId = `server-${n}`;
  const identity = item.artifact.identity;
  const hash = createHash("sha256").update("managed-language-artifact-v1\0");
  for (const part of [identity.server.pluginId, identity.server.serverId, identity.version, identity.target, identity.recipeDigest, identity.archiveDigest, identity.contentDigest]) {
    const bytes = Buffer.from(part), size = Buffer.alloc(8); size.writeBigUInt64BE(BigInt(bytes.length));
    hash.update(size).update(bytes);
  }
  item.artifact.id = `sha256:${hash.digest("hex")}`;
  item.useCount = 2;
  snapshot.artifacts.push(item);
  snapshot.selections.push({ server: identity.server, current: item.artifact.id, rollback: null });
  if (n < 16 || n >= 56) snapshot.operations.push({ id: `job-${n}`, server: identity.server, artifactId: item.artifact.id,
    kind: "install", phase: n < 16 ? "completed" : "acquiring", completedBytes: 16, totalBytes: 16, failure: null });
}
const catalog = JSON.parse(readFileSync(new URL("../protocol/fixtures/language-server-catalog.json", import.meta.url), "utf8")).valid[0].catalog;
catalog.servers[0].id = "server-0";
const pluginId = snapshot.selections[0].server.pluginId;
const selection = new LanguageCatalogIndex([{ pluginId, catalog }]).select({ source: { kind: "editable-source", workspacePath: "src/main.rs" },
  hasWorkspace: true, activePluginIds: new Set([pluginId]), platform: "macos-arm64", rootMarkers: new Set(["Cargo.toml"]), rootMarkersComplete: true, preferredProvider: null });
const target = snapshot.artifacts[0].artifact.identity.target;
const iterations = 300, runs = [], budgets = { acceptP95Ms: 25, recommendP95Ms: 5, retainedHeapBytes: 16 * 1024 * 1024 };
const p95 = values => values.toSorted((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
for (let run = 0; run < 3; run++) {
  const store = new ManagedInstallationFacts();
  for (let n = 0; n < 20; n++) assert.equal(store.accept(store.begin(), snapshot), true);
  global.gc(); const before = process.memoryUsage().heapUsed;
  const accept = [], recommend = [];
  for (let n = 0; n < iterations; n++) {
    let start = performance.now();
    assert.equal(store.accept(store.begin(), snapshot), true);
    accept.push(performance.now() - start);
    start = performance.now();
    assert.equal(recommendManagedInstallation(selection, store.read(), target, null).kind, "installed");
    recommend.push(performance.now() - start);
  }
  global.gc();
  runs.push({ acceptP95Ms: p95(accept), recommendP95Ms: p95(recommend), retainedHeapBytes: process.memoryUsage().heapUsed - before });
}
const result = { platform: `${process.platform}-${process.arch}`, node: process.version, cpu: os.cpus()[0]?.model,
  artifacts: 64, selections: 64, activeJobs: 8, finishedJobs: 16, uses: 128, iterations, budgets, runs,
  scope: "Synthetic in-memory projection only; excludes native storage, WebView/RSS and actual language servers." };
console.log(JSON.stringify(result, null, 2));
for (const run of runs) for (const [key, limit] of Object.entries(budgets)) assert.ok(run[key] <= limit, `${key} exceeded ${limit}`);
