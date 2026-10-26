import assert from "node:assert/strict";
import test from "node:test";
import { WindowSession } from "../src/application/window-session.ts";
import { createLanguageServicesRuntime, languageWorkspaceForWindow } from "../src/composition/language-services-runtime.ts";
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
async function until(check) { for (let i = 0; i < 200 && !check(); i++) await tick(); assert.ok(check(), "expected lifecycle transition did not settle"); }
const provider = { kind: "language-service", qualifiedId: "dev.asterlyn.lsp:typescript", pluginId: "dev.asterlyn.lsp", pluginVersion: "0.1.0", languageIds: ["typescript"], extensions: [".ts"] };
const unrelated = { ...provider, qualifiedId: "other:rust", pluginId: "other", languageIds: ["rust"], extensions: [".rs"] };
const handle = { tabId: "source", path: "source.ts", loadEpoch: 1 };
function harness(approved = true) {
  const window = new WindowSession({}, { schedule() { throw Error("unexpected scheduling"); }, cancel() {} });
  window.beginTransition(); window.workspace.activate({ root: "/repo", repository: null });
  const state = { providers: [provider], calls: [], errors: [], approvals: [], subscribers: new Set(), review: { pluginVersion: "0.1.0", packageDigest: "package", resourceDigest: "resources", executableIdentity: "node-identity" } };
  let next = 0, factory; const reviews = new Set();
  const native = {
    prepare: async (root, pluginId, serverId = "typescript") => { state.calls.push(["prepare", root]); const reviewId = `review-${++next}`; reviews.add(reviewId); return { ...state.review, pluginId, serverId, reviewId, expiresAt: Date.now() + 60000 }; },
    confirm: async (review) => { state.calls.push(["confirm", review.reviewId]); return approved; },
    start: async (root, reviewId) => { assert.equal(reviews.delete(reviewId), true, "each process start must consume its own fresh review"); state.calls.push(["start", root]); return `session-${++next}`; },
    open: async (...args) => { state.calls.push(["open", ...args]); }, change: async () => {}, close: async () => {},
    request: async (_root, sessionId, uri, version) => ({ sessionId, uri, version, result: null }), cancel: async () => {},
    stop: async (...args) => { state.calls.push(["stop", ...args]); },
    subscribe: (listener) => { state.subscribers.add(listener); return () => state.subscribers.delete(listener); },
  };
  const runtime = createLanguageServicesRuntime({ registry: { list: () => state.providers, subscribe: () => () => {} }, native,
    workspace: languageWorkspaceForWindow(window), document: (value) => ({ workspacePath: value.path, readOnly: false, loadEpoch: value.loadEpoch }),
    bind: (value) => { factory = value; }, reportError: (error) => state.errors.push(error), navigate() {}, approvalDiagnostic: (event) => state.approvals.push(event) });
  runtime.refresh();
  const count = (kind) => state.calls.filter((call) => call[0] === kind).length;
  async function open(value = handle) { const port = factory(value); assert.ok(port); port.open(value, { version: 1, text: "const source = 1;" }); await port.request(value, "hover", { position: { line: 0, character: 7 } }, 1); return port; }
  return { state, window, native, runtime, open, count };
}
test("Git operation generations do not expire consent in the real project-session composition", async () => {
  const h = harness(); try {
    await h.open();
    for (let i = 0; i < 5; i++) { h.window.beginTransition(); h.runtime.refresh(); await h.open(); }
    assert.equal(h.count("confirm"), 1, "refresh must not ask the same project to approve again");
    assert.equal(h.count("start"), 1, "ordinary refresh must not restart the approved server");
  } finally { h.runtime.dispose(); }
});
test("an idle current provider retains consent across unrelated contribution refresh", async () => {
  const h = harness(); try {
    const port = await h.open(); port.close(handle); await until(() => h.count("stop") === 1);
    h.state.providers = [provider, unrelated]; h.runtime.refresh(); await h.open();
    assert.equal(h.count("confirm"), 1, "an empty document list must not erase current-project consent");
    assert.equal(h.count("start"), 2, "the idle native server is still stopped and freshly reviewed before restart");
  } finally { h.runtime.dispose(); }
});
test("Not now remains remembered during the current project session", async () => {
  const h = harness(false); try {
    const port = await h.open(); port.close(handle); h.window.beginTransition(); h.runtime.refresh(); await h.open();
    assert.equal(h.count("confirm"), 1); assert.equal(h.count("start"), 0);
  } finally { h.runtime.dispose(); }
});
test("project/worktree change, return to the prior project, and workspace clear revoke remembered consent", async () => {
  const h = harness(); try {
    await h.open();
    for (const root of ["/worktree", "/repo"]) { h.window.workspace.activate({ root, repository: null }); h.runtime.refresh(); await h.open(); }
    assert.equal(h.count("confirm"), 3);
    h.window.workspace.clear(); h.runtime.refresh(); h.window.workspace.activate({ root: "/repo", repository: null }); h.runtime.refresh(); await h.open();
    assert.equal(h.count("confirm"), 4); assert.ok(h.state.approvals.some((event) => event.outcome === "invalidated" && event.reason === "scope-changed"));
  } finally { h.runtime.dispose(); }
});
test("explicit provider disable/removal and version replacement require a fresh confirmation", async () => {
  const h = harness(); try {
    await h.open(); h.runtime.revoke(provider.pluginId); h.state.providers = []; h.runtime.refresh(); h.state.providers = [provider]; h.runtime.refresh(); await h.open();
    assert.equal(h.count("confirm"), 2);
    h.state.providers = [{ ...provider, pluginVersion: "0.2.0" }]; h.state.review.pluginVersion = "0.2.0"; h.runtime.refresh(); await h.open();
    assert.equal(h.count("confirm"), 3);
  } finally { h.runtime.dispose(); }
});
test("a manual native/plugin reactivation retains consent while rebuilding its transport", async () => {
  const h = harness(); try {
    await h.open();
    const sessionId = h.state.calls.find((call) => call[0] === "open")[2];
    for (const listener of h.state.subscribers) listener({ kind: "terminated", sessionId });
    h.state.providers = []; h.runtime.refresh(); h.state.providers = [provider]; h.runtime.refresh(); await h.open();
    assert.equal(h.count("confirm"), 1); assert.equal(h.count("start"), 2); assert.equal(h.count("prepare"), 2);
    assert.ok(h.state.approvals.some((event) => event.outcome === "reused"));
  } finally { h.runtime.dispose(); }
});
test("fresh reviews recheck package, resource and Node identities before reusing consent", async () => {
  const h = harness(); try {
    let port = await h.open();
    for (const field of ["packageDigest", "resourceDigest", "executableIdentity"]) {
      const stops = h.count("stop"); port.close(handle); await until(() => h.count("stop") > stops);
      h.state.review[field] += "-changed"; port = await h.open();
    }
    assert.equal(h.count("confirm"), 4); assert.equal(h.count("prepare"), 4);
    assert.equal(h.state.approvals.filter((event) => event.reason === "identity-changed").length, 3);
    assert.deepEqual(Object.keys(h.state.approvals[0]).sort(), ["outcome", "reason"]);
  } finally { h.runtime.dispose(); }
});
test("a consent answer arriving after a project switch cannot authorize that new project", async () => {
  const h = harness(); let resolve;
  const pending = new Promise((done) => { resolve = done; });
  h.native.confirm = async () => { h.state.calls.push(["confirm"]); return h.count("confirm") === 1 ? pending : true; };
  try {
    const old = h.open(); await until(() => h.count("confirm") === 1);
    h.window.workspace.activate({ root: "/other", repository: null }); h.runtime.refresh(); resolve(true); await old;
    assert.equal(h.count("start"), 0); await h.open(); assert.equal(h.count("confirm"), 2);
    assert.deepEqual(h.state.calls.filter((call) => call[0] === "start"), [["start", "/other"]]);
    assert.ok(h.state.approvals.some((event) => event.outcome === "discarded"));
  } finally { h.runtime.dispose(); }
});
test("idle consent survives 100 empty-document refreshes without retaining native sessions or subscriptions", async () => {
  const h = harness(); try {
    for (let i = 0; i < 100; i++) {
      const port = await h.open(), stops = h.count("stop"); port.close(handle); await until(() => h.count("stop") > stops);
      h.state.providers = [provider, { ...unrelated, qualifiedId: `other:rust-${i}` }]; h.runtime.refresh();
    }
    assert.equal(h.count("confirm"), 1); assert.equal(h.count("start"), 100); assert.equal(h.count("stop"), 100);
    assert.equal(h.state.subscribers.size, 1); assert.equal(h.state.approvals.filter((event) => event.outcome === "reused").length, 99);
  } finally { h.runtime.dispose(); }
  assert.equal(h.state.subscribers.size, 0); assert.equal(h.state.errors.length, 0);
});
test("disposing and constructing a new runtime does not remember consent across restarts", async () => {
  const h = harness(); await h.open(); h.runtime.dispose(); assert.ok(h.state.approvals.some((event) => event.outcome === "invalidated" && event.reason === "shutdown"));
  const restarted = harness(); try { await restarted.open(); assert.equal(restarted.count("confirm"), 1); } finally { restarted.runtime.dispose(); }
});
test("changing workspaces prunes old decisions below the bounded consent-cache limit", async () => {
  const h = harness(); try {
    for (let i = 0; i < 40; i++) { h.window.workspace.activate({ root: `/project-${i}`, repository: null }); h.runtime.refresh(); await h.open(); }
    assert.equal(h.count("confirm"), 40); assert.equal(h.state.errors.length, 0);
  } finally { h.runtime.dispose(); }
});

test("TypeScript and Rust have separate consent, sessions and idle cleanup in one workspace", async () => {
  const h = harness(); try {
    h.state.providers = [{ ...provider, serverId: "typescript" }, { ...provider, serverId: "rust-analyzer", qualifiedId: "dev.asterlyn.lsp:rust", languageIds: ["rust"], extensions: [".rs"] }];
    h.runtime.refresh();
    const ts = await h.open();
    const rustHandle = { ...handle, tabId: "rust", path: "src/lib.rs" };
    const rust = await h.open(rustHandle);
    assert.equal(h.count("confirm"), 2); assert.equal(h.count("start"), 2);
    const opened = h.state.calls.filter((c) => c[0] === "open");
    assert.notEqual(opened[0][2], opened[1][2]);
    rust.close(rustHandle); await until(() => h.count("stop") === 1);
    await ts.request(handle, "hover", { position: { line: 0, character: 0 } }, 1);
    assert.equal(h.count("start"), 2, "stopping Rust keeps the TypeScript transport");
    await h.open(rustHandle); assert.equal(h.count("confirm"), 2); assert.equal(h.count("start"), 3);
  } finally { h.runtime.dispose(); }
});
