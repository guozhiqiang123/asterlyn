import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LanguageCatalogIndex } from "../src/application/language-services/catalog-selection.ts";
import { ManagedInstallationFacts } from "../src/application/language-services/installation-facts.ts";
import { recommendManagedInstallation } from "../src/application/language-services/installation-recommendation.ts";

const base = JSON.parse(readFileSync(new URL("../protocol/fixtures/managed-language-installation.json", import.meta.url), "utf8")).base;
const catalog = JSON.parse(readFileSync(new URL("../protocol/fixtures/language-server-catalog.json", import.meta.url), "utf8")).valid[0].catalog;
catalog.servers[0].id = "rust";
const pluginId = "dev.example.lsp", target = "aarch64-apple-darwin";
const selected = new LanguageCatalogIndex([{ pluginId, catalog }]).select({
  source: { kind: "editable-source", workspacePath: "src/main.rs" }, hasWorkspace: true, activePluginIds: new Set([pluginId]),
  platform: "macos-arm64", rootMarkers: new Set(["Cargo.toml"]), rootMarkersComplete: true, preferredProvider: null,
});
assert.equal(selected.kind, "selected");
const recipe = { providerKey: selected.provider.key, target, available: true };
const empty = () => ({ ...structuredClone(base), artifacts: [], selections: [], operations: [] });
const operation = (overrides = {}) => ({ id: "job-1", server: base.selections[0].server, artifactId: base.artifacts[0].artifact.id,
  kind: "install", phase: "acquiring", completedBytes: 0, totalBytes: 16, failure: null, ...overrides });
function facts(snapshot = base) {
  const store = new ManagedInstallationFacts();
  assert.equal(store.accept(store.begin(), snapshot), true);
  return store.read();
}
const recommend = (snapshot = base, availability = recipe, nativeTarget = target) => recommendManagedInstallation(selected, facts(snapshot), nativeTarget, availability);

test("missing service needs current native facts and matching admitted recipe before offering installation", () => {
  assert.deepEqual(recommend(empty()), { kind: "install-available", providerKey: recipe.providerKey });
  for (const unavailable of [null, { ...recipe, available: false }, { ...recipe, providerKey: "other" }, { ...recipe, target: "x86_64-unknown-linux-gnu" }]) {
    assert.deepEqual(recommend(empty(), unavailable), { kind: "unavailable", reason: "recipe" });
  }
});

test("disabled, ineligible, conflicting and unselected catalog results suppress installation recommendations", () => {
  for (const kind of ["inactive", "ineligible-document", "unknown-language", "language-conflict", "unconfigured", "platform-unavailable", "project-unmatched", "project-unknown", "preferred-unavailable", "provider-conflict"]) {
    assert.deepEqual(recommendManagedInstallation({ kind }, facts(empty()), target, recipe), { kind: "none", reason: kind });
  }
});

test("loading or failed installation reads never mean missing", () => {
  const store = new ManagedInstallationFacts();
  assert.deepEqual(recommendManagedInstallation(selected, store.read(), target, recipe), { kind: "unavailable", reason: "installation-facts" });
  const request = store.begin();
  assert.deepEqual(recommendManagedInstallation(selected, store.read(), target, recipe), { kind: "checking" });
  store.fail(request);
  assert.equal(recommendManagedInstallation(selected, store.read(), target, recipe).kind, "unavailable");
});

test("installed is separate from execution permission and semantic readiness for managed and external artifacts", () => {
  for (const ownership of ["managed", "external"]) {
    const snapshot = structuredClone(base); snapshot.artifacts[0].artifact.ownership = ownership;
    const result = recommend(snapshot, null);
    assert.equal(result.kind, "installed");
    assert.deepEqual(Object.keys(result).sort(), ["kind", "status"]);
    assert.equal(result.status.useCount, 0);
  }
});

test("restored or invalidated content needs verification rather than installation", () => {
  const snapshot = structuredClone(base); snapshot.artifacts[0].verification = "required";
  assert.equal(recommend(snapshot).kind, "verification-required");
});

test("rollback and unselected history are recoverable but are never silently selected or reinstalled", () => {
  const snapshot = structuredClone(base); snapshot.selections[0].rollback = snapshot.selections[0].current; snapshot.selections[0].current = null;
  assert.deepEqual(recommend(snapshot), { kind: "recovery-available", artifactIds: [base.artifacts[0].artifact.id] });
  snapshot.selections = [];
  assert.equal(recommend(snapshot).kind, "recovery-available");
});

test("wrong or malformed targets cannot turn existing content into an install prompt", () => {
  for (const nativeTarget of ["x86_64-unknown-linux-gnu", `${target}\n`, "", "../../server"]) {
    assert.deepEqual(recommend(base, { ...recipe, target: nativeTarget }, nativeTarget), { kind: "unavailable", reason: "target" });
  }
  const snapshot = structuredClone(base); snapshot.selections = [];
  assert.deepEqual(recommend(snapshot, recipe, "x86_64-unknown-linux-gnu"), { kind: "unavailable", reason: "target" });
});

test("service identities include plugin owner and operation filtering does not collide by server id", () => {
  const other = { ...selected, provider: { ...selected.provider, pluginId: "other.plugin", key: '["other.plugin","rust"]' } };
  const snapshot = structuredClone(base); snapshot.operations.push(operation());
  assert.deepEqual(recommendManagedInstallation(other, facts(snapshot), target, { ...recipe, providerKey: other.provider.key }), { kind: "install-available", providerKey: other.provider.key });
});

test("active installs and removals take priority over the preserved current version", () => {
  for (const phase of ["acquiring", "verifying", "committing"]) {
    const snapshot = structuredClone(base); snapshot.operations.push(operation({ phase, completedBytes: 16 }));
    assert.equal(recommend(snapshot).kind, "installing");
  }
  const snapshot = structuredClone(base); snapshot.operations.push(operation({ kind: "remove", phase: "waiting-for-uses", totalBytes: 0 }));
  snapshot.artifacts[0].useCount = 2;
  assert.equal(recommend(snapshot).kind, "removing");
});

test("failed or cancelled updates preserve installed facts and terminal jobs never fabricate installation", () => {
  for (const phase of ["failed", "cancelled", "completed"]) {
    const finished = operation({ phase, completedBytes: 16, failure: phase === "failed" ? "storage-failed" : null });
    const snapshot = structuredClone(base); snapshot.operations.push(finished);
    assert.equal(recommend(snapshot).kind, "installed");
    const missing = empty(); missing.operations.push(finished);
    assert.equal(recommend(missing).kind, "install-available");
  }
});

test("accepted facts are copied and deeply immutable", () => {
  const snapshot = structuredClone(base), store = new ManagedInstallationFacts();
  assert.equal(store.accept(store.begin(), snapshot), true);
  snapshot.artifacts.length = 0;
  assert.equal(store.read().snapshot.artifacts.length, 1);
  assert.throws(() => { store.read().snapshot.artifacts[0].artifact.identity.version = "changed"; });
  assert.throws(() => { store.read().kind = "unavailable"; });
});

test("superseded reads, duplicate replies and foreign request identities cannot replace newer facts", () => {
  const store = new ManagedInstallationFacts(), other = new ManagedInstallationFacts();
  const old = store.begin(), current = store.begin();
  assert.equal(store.accept(old, empty()), false);
  assert.equal(store.fail(old), false);
  assert.equal(store.accept(other.begin(), empty()), false);
  assert.equal(store.read().kind, "checking");
  assert.equal(store.accept(current, base), true);
  assert.equal(store.accept(current, empty()), false);
  assert.equal(store.fail(current), false);
  assert.equal(store.read().snapshot.artifacts.length, 1);
});

test("workspace activation or bridge reset discards old requests and native epoch anchors", () => {
  const store = new ManagedInstallationFacts(), old = store.begin();
  store.reset();
  assert.equal(store.accept(old, base), false);
  assert.equal(store.read().kind, "unavailable");
  assert.equal(store.accept(store.begin(), { ...base, epoch: "new-host", revision: 0 }), true);
});

test("backwards facts, unexpected epochs and malformed replies close availability until a fresh read", () => {
  const store = new ManagedInstallationFacts();
  assert.equal(store.accept(store.begin(), base), true);
  for (const invalid of [{ ...base, revision: 2 }, { ...base, indexRevision: 0 }, { ...base, indexRevision: 2 }, { ...base, epoch: "other-host" }, { ...base, future: true }, null]) {
    assert.equal(store.accept(store.begin(), invalid), false);
    assert.equal(store.read().kind, "unavailable");
  }
  assert.equal(store.accept(store.begin(), base), true);
  assert.equal(store.accept(store.begin(), { ...base, revision: 4, indexRevision: 2 }), true);
});
