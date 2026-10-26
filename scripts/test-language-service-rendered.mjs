import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({ root: process.cwd(), server: { host: "127.0.0.1", port: 0, hmr: false }, plugins: [{ name: "language-service-fixture", configureServer(vite) { vite.middlewares.use("/__language_service", (_request, response) => { response.setHeader("Content-Type", "text/html"); response.end(`<!doctype html><html><head><script type="module">import "/src/styles.css";</script></head><body><main id="editor" style="width:900px;height:500px"></main></body></html>`); }); } }] });
await server.listen();
const address = server.httpServer.address();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/__language_service`, { waitUntil: "domcontentloaded", timeout: 10000 });
  await page.evaluate(async () => {
    const [{ TextEditor }, { DEFAULT_APP_PREFERENCES }, { EN_US }, { startCompletion }, { undo }] = await Promise.all([import("/src/text-editor.ts"), import("/src/preferences.ts"), import("/src/localization/en-US.ts"), import("/node_modules/@codemirror/autocomplete/dist/index.js"), import("/node_modules/@codemirror/commands/dist/index.js")]);
    const events = [];
    let diagnosticsListener = null;
    const port = {
      open(handle, snapshot) { events.push({ type: "open", handle: { ...handle }, snapshot }); },
      update(handle, snapshot) { events.push({ type: "update", handle: { ...handle }, snapshot }); },
      close(handle) { events.push({ type: "close", handle: { ...handle } }); },
      subscribeDiagnostics(listener) { diagnosticsListener = listener; return () => { diagnosticsListener = null; }; },
      request(_handle, method) {
        if (method !== "textDocument/completion") return Promise.resolve(null);
        return Promise.resolve({ items: [{ label: "answer", detail: "UTF-16 edit", textEdit: { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } }, newText: "answer" } }] });
      },
    };
    const editor = new TextEditor({ load: async () => null, openCommit() {}, status() {}, error() {} }, EN_US.editor);
    editor.setLanguageServices(() => port);
    editor.mount(document.querySelector("#editor"), "tab-a", 1, "const value = 1;\n", "const value = 1;\n", "/repo/main.ts", DEFAULT_APP_PREFERENCES, null, "untracked", () => {});
    window.languageServiceFixture = { editor, port, events, preferences: DEFAULT_APP_PREFERENCES, startCompletion, undo, get diagnosticsListener() { return diagnosticsListener; } };
  });
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("End");
  await page.keyboard.insertText("\nvalue");
  await page.waitForFunction(() => window.languageServiceFixture.events.some((event) => event.type === "update" && event.snapshot.text.endsWith("\nvalue")), null, { timeout: 10000 });
  await page.locator(".cm-content").click();
  const completed = await page.evaluate(async () => { const entry = window.languageServiceFixture.editor.activeEntry(); const view = entry.view; const result = await window.languageServiceFixture.editor.complete(entry, { state: view.state, pos: view.state.selection.main.head, explicit: true, matchBefore: () => ({ from: 6, to: 11, text: "value" }) }); if (!result?.options?.length) return { text: view.state.doc.toString(), result: null }; result.options[0].apply(view, result.options[0], 6, 11); return { text: view.state.doc.toString(), result: result.options[0].label }; });
  assert.equal(completed.result, "answer", `completion result missing: ${completed.text}`);
  const completionText = await page.evaluate(() => window.languageServiceFixture.editor.activeEntry().view.state.doc.toString());
  assert.match(completionText, /answer/, "completion text edit was applied");
  await page.evaluate(() => window.languageServiceFixture.diagnosticsListener?.({ handle: { tabId: "tab-a", path: "/repo/main.ts", loadEpoch: 1 }, version: 3, diagnostics: [{ message: "test diagnostic", severity: 1, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } }] }));
  await page.waitForSelector(".cm-lintRange", { timeout: 10000 });
  await page.evaluate(() => window.languageServiceFixture.editor.setReadOnly(true));
  assert.equal(await page.evaluate(() => window.languageServiceFixture.events.at(-1).type), "close", "read-only transition closes the service");
  await page.evaluate(() => window.languageServiceFixture.editor.setReadOnly(false));
  await page.evaluate(() => window.languageServiceFixture.editor.mount(document.querySelector("#editor"), "tab-a", 2, "const next = 2;\n", "const next = 2;\n", "/repo/main.ts", window.languageServiceFixture.preferences, null, "untracked", () => {}));
  await page.waitForFunction(() => window.languageServiceFixture.events.filter((event) => event.type === "open").some((event) => event.handle.loadEpoch === 2), null, { timeout: 10000 });
  const events = await page.evaluate(() => window.languageServiceFixture.events);
  assert.ok(events.some((event) => event.type === "close" && event.handle.loadEpoch === 1), "epoch replacement closes the old handle");
  assert.ok(events.some((event) => event.type === "open" && event.handle.loadEpoch === 2), "epoch replacement opens a fresh handle");
} finally {
  await browser.close();
  await server.close();
}
