import assert from "node:assert/strict";
import test from "node:test";
import { createEditorLanguageServicePort } from "../src/features/language-services/language-service-client.ts";

const handle = { tabId: "tab", path: "file:///repo/a.ts", loadEpoch: 1 };
const identity = { workspaceRoot: "/repo", workspaceGeneration: 1, uri: "file:///repo/a.ts", languageId: "typescript", pluginId: "dev.asterlyn.lsp" };
function fakeNative({ approved = true } = {}) {
  const calls = []; const events = new Set(); let n = 0;
  return { calls, events, prepare: async (...args) => { calls.push(["prepare", ...args]); return { reviewId: `r${++n}`, pluginId: identity.pluginId, serverId: "typescript" }; }, confirm: async () => { calls.push(["confirm"]); return approved; }, start: async (...args) => { calls.push(["start", ...args]); return "session"; }, open: async (...args) => calls.push(["open", ...args]), change: async (...args) => calls.push(["change", ...args]), close: async (...args) => calls.push(["close", ...args]), request: async (...args) => { calls.push(["request", ...args]); return { sessionId: "session", uri: identity.uri, version: args[3], result: { ok: true } }; }, cancel: async (...args) => calls.push(["cancel", ...args]), stop: async (...args) => calls.push(["stop", ...args]), subscribe: (listener) => { events.add(listener); return () => events.delete(listener); } };
}
const wait = () => new Promise((resolve) => setTimeout(resolve, 20));

test("unsaved snapshot is opened before request and stale version is dropped", async () => {
  const native = fakeNative(); const factory = createEditorLanguageServicePort(() => identity, native, (error) => { throw error; }); const port = factory(handle);
  port.open(handle, { version: 1, text: "const x = 1" }); await wait();
  assert.deepEqual(native.calls.map((call) => call[0]).slice(0, 3), ["prepare", "confirm", "start"]);
  const result = await port.request(handle, "hover", { position: { line: 0, character: 1 } }, 1); assert.deepEqual(result, { ok: true });
  port.update(handle, { version: 2, text: "const x = 2" }); await wait();
  assert.equal(await port.request(handle, "hover", { position: { line: 0, character: 1 } }, 1), null);
});

test("denial does not start and is cached", async () => {
  const native = fakeNative({ approved: false }); const factory = createEditorLanguageServicePort(() => identity, native, () => undefined); const port = factory(handle);
  port.open(handle, { version: 1, text: "x" }); await wait(); port.open(handle, { version: 1, text: "x" }); await wait();
  assert.equal(native.calls.filter((call) => call[0] === "start").length, 0); assert.equal(native.calls.filter((call) => call[0] === "confirm").length, 1);
});

test("close stops the shared session and diagnostics subscription can be removed", async () => {
  const native = fakeNative(); const factory = createEditorLanguageServicePort(() => identity, native, () => undefined); const port = factory(handle); let diagnostics = 0; const unsubscribe = port.subscribeDiagnostics(() => diagnostics++);
  port.open(handle, { version: 1, text: "x" }); await wait(); port.close(handle); await wait(); assert.equal(native.calls.some((call) => call[0] === "stop"), true); unsubscribe();
  for (const listener of native.events) listener({ sessionId: "session", kind: "diagnostics", uri: identity.uri, version: 1, diagnostics: [] }); assert.equal(diagnostics, 0);
});
