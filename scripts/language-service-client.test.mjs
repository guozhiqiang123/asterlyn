import assert from "node:assert/strict";
import test from "node:test";
import { createEditorLanguageServicePort } from "../src/features/language-services/language-service-client.ts";

const handleA = { tabId: "tab-a", path: "file:///repo/a.ts", loadEpoch: 1 };
const handleB = { tabId: "tab-b", path: "file:///repo/b.ts", loadEpoch: 1 };
const identityFor = (handle, generation = 1) => ({ workspaceRoot: "/repo", workspaceGeneration: generation, uri: handle.path, languageId: "typescript", pluginId: "dev.asterlyn.lsp", providerVersion: "1.0.0" });
const review = (id) => ({ reviewId: id, pluginId: "dev.asterlyn.lsp", serverId: "typescript", pluginVersion: "1.0.0", packageDigest: "sha256:package", resourceDigest: "sha256:resources", executableIdentity: "/usr/local/bin/node@22.22.2", expiresAt: Date.now() + 60_000 });
const wait = () => new Promise((resolve) => setTimeout(resolve, 25));

function fakeNative({ approved = true, requestResult = { ok: true } } = {}) {
  const calls = []; const events = new Set(); let sequence = 0; let deferredRequest = null; let deferredPrepare = null;
  const native = {
    calls, events,
    prepare: async (...args) => { calls.push(["prepare", ...args]); if (deferredPrepare) return deferredPrepare.promise; return review(`review-${++sequence}`); },
    confirm: async (...args) => { calls.push(["confirm", ...args]); return approved; },
    start: async (...args) => { calls.push(["start", ...args]); native.lastSession = `session-${++sequence}`; return native.lastSession; },
    open: async (...args) => calls.push(["open", ...args]), change: async (...args) => calls.push(["change", ...args]), close: async (...args) => calls.push(["close", ...args]),
    request: async (...args) => { calls.push(["request", ...args]); if (deferredRequest) return deferredRequest.promise; return { sessionId: args[1], uri: args[2], version: args[3], result: requestResult }; },
    cancel: async (...args) => calls.push(["cancel", ...args]), stop: async (...args) => calls.push(["stop", ...args]),
    subscribe: (listener) => { events.add(listener); return () => events.delete(listener); },
  };
  native.deferRequest = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); deferredRequest = { promise, resolve }; return deferredRequest; };
  native.deferPrepare = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); deferredPrepare = { promise, resolve }; return deferredPrepare; };
  return native;
}

test("flushes unsaved snapshots before hover and drops stale versions", async () => {
  const native = fakeNative(); const factory = createEditorLanguageServicePort((handle) => identityFor(handle), native, (error) => { throw error; }); const port = factory(handleA);
  port.open(handleA, { version: 1, text: "const x = 1" }); await wait(); port.update(handleA, { version: 2, text: "const x = 2" });
  assert.deepEqual(await port.request(handleA, "textDocument/hover", { position: { line: 0, character: 1 } }, 2), { ok: true });
  const names = native.calls.map((call) => call[0]); assert.ok(names.indexOf("open") < names.indexOf("change")); assert.ok(names.indexOf("change") < names.lastIndexOf("request"), "latest snapshot must flush before request");
  assert.equal(await port.request(handleA, "hover", { position: { line: 0, character: 1 } }, 1), null); factory.dispose();
});

test("routes diagnostics by URI for two documents in one workspace", async () => {
  const native = fakeNative(); const factory = createEditorLanguageServicePort((handle) => identityFor(handle), native, () => undefined); const portA = factory(handleA); const portB = factory(handleB); const receivedA = []; const receivedB = [];
  portA.subscribeDiagnostics((event) => receivedA.push(event)); portB.subscribeDiagnostics((event) => receivedB.push(event)); portA.open(handleA, { version: 1, text: "a" }); portB.open(handleB, { version: 1, text: "b" }); await wait();
  const session = native.lastSession; for (const listener of native.events) listener({ sessionId: session, kind: "diagnostics", uri: handleB.path, version: 1, diagnostics: [{ message: "b", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }] });
  assert.equal(receivedA.at(-1).diagnostics.length, 0); assert.equal(receivedB.at(-1).handle.tabId, "tab-b"); assert.equal(receivedB.at(-1).diagnostics[0].message, "b"); factory.dispose();
});

test("denial never starts and is cached", async () => {
  const native = fakeNative({ approved: false }); const factory = createEditorLanguageServicePort((handle) => identityFor(handle), native, () => undefined); const port = factory(handleA); port.open(handleA, { version: 1, text: "x" }); await wait(); port.open(handleA, { version: 2, text: "y" }); await wait();
  assert.equal(native.calls.filter((call) => call[0] === "start").length, 0); assert.equal(native.calls.filter((call) => call[0] === "confirm").length, 1); factory.dispose();
});

test("cancels and drops a pending result after an edit", async () => {
  const native = fakeNative(); const factory = createEditorLanguageServicePort((handle) => identityFor(handle), native, () => undefined); const port = factory(handleA); port.open(handleA, { version: 1, text: "value" }); await wait();
  const deferred = native.deferRequest(); const pending = port.request(handleA, "completion", { position: { line: 0, character: 2 } }, 1); await wait(); port.update(handleA, { version: 2, text: "value!" }); await wait();
  assert.equal(native.calls.filter((call) => call[0] === "cancel").length, 1); deferred.resolve({ sessionId: "session-1", uri: handleA.path, version: 1, result: { stale: true } }); assert.equal(await pending, null); factory.dispose();
});

test("reconcile closes and stops the old generation", async () => {
  const native = fakeNative(); let generation = 1; const factory = createEditorLanguageServicePort((handle) => identityFor(handle, generation), native, () => undefined); const port = factory(handleA); port.open(handleA, { version: 1, text: "x" }); await wait(); generation = 2; factory.reconcile(); await wait();
  assert.ok(native.calls.some((call) => call[0] === "stop")); factory.dispose();
});

test("closing before approval prevents start and dispose removes native listener", async () => {
  const native = fakeNative(); const preparing = native.deferPrepare(); const factory = createEditorLanguageServicePort((handle) => identityFor(handle), native, () => undefined); const port = factory(handleA); port.open(handleA, { version: 1, text: "x" }); await wait();
  port.close(handleA); preparing.resolve(review("late-review")); await wait(); assert.equal(native.calls.filter((call) => call[0] === "start").length, 0); factory.dispose(); assert.equal(native.events.size, 0);
});
