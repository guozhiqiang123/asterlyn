import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";
const server = await createServer({ root: process.cwd(), server: { host: "127.0.0.1", port: 0, hmr: false }, plugins: [{ name: "definition-fixture", configureServer(vite) { vite.middlewares.use("/__definition", (_req, res) => { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html><body><main id="editor" style="width:960px;height:460px"></main><script type="module" src="/scripts/fixtures/language-definition-fixture.ts"></script></body></html>'); }); } }] });
await server.listen(); const port = server.httpServer.address().port;
try {
 for (const [name, engine] of [["Chromium", chromium], ["WebKit", webkit]]) {
  const browser = await engine.launch(); const page = await browser.newPage(); const errors = [];
  const started = performance.now(); let heapBefore = null;
  const cdp = name === "Chromium" ? await page.context().newCDPSession(page) : null;
  page.on("pageerror", (error) => errors.push(error.message));
  const snap = () => page.evaluate(() => window.definitionFixture.snapshot());
  const reset = async (mode = "link") => { await page.evaluate((mode) => window.definitionFixture.reset(mode), mode); await page.waitForTimeout(40); };
  const point = () => page.evaluate(() => window.definitionFixture.point());
  const click = async (modifier = "Control") => { const p = await point(); await page.keyboard.down(modifier); await page.mouse.click(p.x, p.y); await page.keyboard.up(modifier); };
  try {
   await page.goto(`http://127.0.0.1:${port}/__definition`, { waitUntil: "networkidle" }); await page.waitForFunction(() => !!window.definitionFixture);
   await page.evaluate(() => { window.gestureEvents = []; for (const type of ["mousedown", "mouseup", "contextmenu", "blur"]) document.addEventListener(type, (event) => { window.gestureEvents.push({ type, button: event.button, ctrl: event.ctrlKey, meta: event.metaKey, prevented: event.defaultPrevented, target: event.target?.nodeName }); if (window.gestureEvents.length > 30) window.gestureEvents.shift(); }, true); });
   await reset(); const p = await point(); await page.mouse.move(p.x, p.y); await page.keyboard.down("Control");
   await page.waitForSelector(".cm-definition-link"); await page.mouse.move(p.x + 1, p.y); await page.mouse.move(p.x + 2, p.y);
   assert.equal((await snap()).requests.length, 0, `${name}: pointer movement must not query LSP`);
   await page.keyboard.up("Control"); assert.equal(await page.locator(".cm-definition-link").count(), 0);
   const original = await snap(); assert.equal(original.head, 0);
   await click(); await page.waitForFunction(() => window.definitionFixture.state.active.workspacePath === "目录/target file.ts");
   let result = await snap(); assert.equal(result.selection, "target"); assert.equal(result.focused, true); assert.match(result.text, /^\/\/ unsaved 😀/u);
   assert.equal(result.requests.length, 1); assert.deepEqual(result.requests[0].params.position, { line: 2, character: 17 });
   // Syntax-colored spans can be detached when the pointer underline is cleared on mousedown.
   await reset(); const colored = await page.evaluate(() => window.definitionFixture.point("start"));
   await page.mouse.move(colored.x, colored.y); await page.keyboard.down("Control"); await page.waitForSelector(".cm-definition-link");
   await page.mouse.click(colored.x, colored.y); await page.keyboard.up("Control");
   await page.waitForFunction(() => window.definitionFixture.state.active.workspacePath === "目录/target file.ts");
   await reset(); const normal = await point(); await page.mouse.click(normal.x, normal.y); assert.equal((await snap()).requests.length, 0);
   await page.mouse.click(normal.x, normal.y, { button: "right" }); assert.equal((await snap()).requests.length, 0);
   await page.keyboard.down("Control"); await page.mouse.click(normal.x, normal.y, { button: "right" }); await page.keyboard.up("Control"); assert.equal((await snap()).requests.length, 0, `${name}: modified right button must not navigate`);
   const gutter = await page.locator(".cm-lineNumbers").boundingBox(); await page.keyboard.down("Control"); await page.mouse.click(gutter.x + gutter.width / 2, normal.y); await page.keyboard.up("Control"); assert.equal((await snap()).requests.length, 0, `${name}: gutter must not navigate`);
   await reset(); const drag = await point(); await page.keyboard.down("Control"); await page.mouse.move(drag.x, drag.y); await page.mouse.down(); await page.mouse.move(drag.x + 45, drag.y, { steps: 4 }); await page.mouse.up(); await page.keyboard.up("Control"); assert.equal((await snap()).requests.length, 0, `${name}: modified drag must not jump`);
   await reset("same"); await click(); await page.waitForFunction(() => window.definitionFixture.snapshot().selection === "target"); assert.equal((await snap()).active, "source.ts");
   await reset("multiple"); await click(); await page.waitForSelector('.language-location-picker[role="dialog"]'); assert.equal((await snap()).active, "source.ts");
   await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); await page.waitForFunction(() => window.definitionFixture.state.active.workspacePath === "other.ts"); assert.equal((await snap()).selection, "target");
   await reset("multiple"); await click(); await page.waitForSelector('.language-location-picker[role="dialog"]'); await page.keyboard.press("Escape"); assert.equal((await snap()).active, "source.ts"); assert.equal((await snap()).focused, true);
   await reset("self"); await click(); await page.waitForSelector('.language-location-picker[role="dialog"]');
   assert.deepEqual((await snap()).requests.map((request) => request.method), ["textDocument/definition", "textDocument/references"], `${name}: declaration navigation must query usages`);
   assert.match(await page.locator('.language-location-picker').innerText(), /Choose a reference/u);
   await page.getByRole("combobox", { name: "Filter by file or path" }).fill("other.ts"); assert.equal(await page.getByRole("option").count(), 1);
   assert.equal((await snap()).requests.length, 2, `${name}: filtering must not query LSP`);
   await page.keyboard.press("Enter"); await page.waitForFunction(() => window.definitionFixture.state.active.workspacePath === "other.ts"); assert.equal((await snap()).selection, "target");
   await reset("self"); await click(); await page.getByRole("option").filter({ hasText: "other.ts" }).click(); await page.waitForFunction(() => window.definitionFixture.state.active.workspacePath === "other.ts");
   await reset("oneReference"); await click(); await page.waitForFunction(() => window.definitionFixture.state.active.workspacePath === "other.ts"); assert.equal(await page.locator('.language-location-picker').count(), 0);
   await reset("oneReference"); await page.locator(".cm-content").click(); await page.keyboard.press("Shift+F12"); await page.waitForSelector('.language-location-picker'); assert.equal(await page.getByRole("option").count(), 1); assert.equal((await snap()).requests[0].method, "textDocument/references"); await page.keyboard.press("Escape");
   await reset("oneReference"); await page.locator(".cm-content").click(); await page.keyboard.press("Alt+F7"); await page.waitForSelector('.language-location-picker'); assert.equal((await snap()).requests[0].method, "textDocument/references"); await page.keyboard.press("Escape");
   await reset("noReferences"); await click(); await page.waitForFunction(() => window.definitionFixture.state.statuses.some((status) => status.message === "No references were found.")); assert.equal((await snap()).active, "source.ts");
   await reset("manyReferences"); await page.locator(".cm-content").click(); await page.keyboard.press("Shift+F12"); await page.waitForSelector('.language-location-picker'); assert.equal(await page.getByRole("option").count(), 512); assert.match(await page.getByRole("status").innerText(), /first 512/u);
   const pickerBounds = await page.locator('.language-location-picker').boundingBox(), viewport = page.viewportSize(); assert.ok(pickerBounds.x >= 0 && pickerBounds.y >= 0 && pickerBounds.x + pickerBounds.width <= viewport.width && pickerBounds.y + pickerBounds.height <= viewport.height, `${name}: picker must fit in the viewport`);
   await page.keyboard.press("End"); assert.equal(await page.getByRole("option").last().getAttribute("aria-selected"), "true");
   await page.getByRole("combobox").fill("not-a-file"); assert.equal(await page.getByRole("option").count(), 0); await page.keyboard.press("Enter"); assert.equal((await snap()).active, "source.ts");
   for (const action of ["edit", "tab", "newer", "destroy"]) {
    await reset("deferredReferences"); await click(); await page.waitForFunction(() => window.definitionFixture.state.pending.length === 1);
    if (action === "edit") await page.keyboard.insertText("x");
    else if (action === "tab") await page.evaluate(() => window.definitionFixture.otherTab());
    else if (action === "newer") { await page.evaluate(() => { window.definitionFixture.state.mode = "same"; }); await click(); await page.waitForFunction(() => window.definitionFixture.snapshot().selection === "target"); }
    else await page.evaluate(() => window.definitionFixture.editor.detach());
    await page.evaluate(() => window.definitionFixture.resolve()); await page.waitForTimeout(40); assert.equal(await page.locator('.language-location-picker').count(), 0, `${name}: stale reference ${action} opened a picker`);
   }
   await reset("indexing"); await click();
   await page.waitForFunction(() => window.definitionFixture.state.statuses.some((status) => status.message.includes("indexing")));
   assert.equal((await snap()).statuses.at(-1).kind, "information");
   assert.equal((await snap()).outcomes.some((event) => event.outcome === "empty"), false, "indexing is not an empty definition result");
   await reset("empty"); await click(); await page.waitForFunction(() => window.definitionFixture.state.statuses.some((status) => status.kind === "warning")); assert.equal((await snap()).active, "source.ts");
   await reset("outside"); await click(); await page.waitForFunction(() => window.definitionFixture.state.statuses.some((status) => status.message.includes("catalog"))); assert.equal((await snap()).active, "source.ts");
   await reset("readonly"); await click(); await page.waitForFunction(() => window.definitionFixture.state.active.workspacePath === "SDK.java");
   const sdkBefore = await snap(); assert.equal(sdkBefore.selection, "Target"); assert.equal(sdkBefore.focused, true);
   await page.keyboard.insertText("must not edit"); assert.equal((await snap()).text, sdkBefore.text, `${name}: dependency source must be read only`);
   await page.keyboard.press("Home"); await page.keyboard.press("End");
   assert.equal((await snap()).text, sdkBefore.text); assert.equal((await snap()).focused, true, `${name}: readonly source retains keyboard focus`);
   for (const action of ["edit", "click", "tab", "escape", "newer"]) {
    await reset("deferred"); await click(); await page.waitForFunction(() => window.definitionFixture.state.pending.length === 1);
    if (action === "edit") await page.keyboard.insertText("x");
    else if (action === "click") { const p = await page.evaluate(() => window.definitionFixture.point("start")); await page.mouse.click(p.x, p.y); }
    else if (action === "tab") await page.evaluate(() => window.definitionFixture.otherTab());
    else if (action === "escape") await page.keyboard.press("Escape");
    else { await page.evaluate(() => { window.definitionFixture.state.mode = "same"; }); await click(); await page.waitForFunction(() => window.definitionFixture.snapshot().selection === "target"); }
    await page.evaluate(() => window.definitionFixture.resolve()); await page.waitForTimeout(40); assert.notEqual((await snap()).active, "目录/target file.ts", `${name}: stale ${action} response navigated`);
   }
   await reset("same"); await page.locator(".cm-content").click(); await page.keyboard.press("F12"); await page.waitForFunction(() => window.definitionFixture.snapshot().selection === "target");
   await reset("deferred"); await page.locator(".cm-content").click(); await page.keyboard.down("F12"); await page.keyboard.down("F12"); await page.keyboard.down("F12"); await page.keyboard.up("F12"); assert.equal((await snap()).requests.length, 1, `${name}: held F12 must not issue repeated queries`);
   await reset("deferredReferences"); await page.locator(".cm-content").click(); await page.keyboard.down("Alt"); await page.keyboard.down("F7"); await page.keyboard.down("F7"); await page.keyboard.up("F7"); await page.keyboard.up("Alt"); assert.equal((await snap()).requests.length, 1, `${name}: held Find Usages must not issue repeated queries`);
   if (await page.evaluate(() => /Mac/u.test(navigator.platform))) { await reset(); await click("Meta"); await page.waitForFunction(() => window.definitionFixture.state.active.workspacePath === "目录/target file.ts"); }
   await reset(); await page.evaluate(() => window.definitionFixture.editor.setReadOnly(true)); await click(); assert.equal((await snap()).requests.length, 0);
   if (cdp) { await cdp.send("HeapProfiler.collectGarbage"); heapBefore = (await cdp.send("Runtime.getHeapUsage")).usedSize; }
   for (let cycle = 0; cycle < 20; cycle++) { await reset(cycle % 2 ? "same" : "multiple"); await click(); if (cycle % 2) await page.waitForFunction(() => window.definitionFixture.snapshot().selection === "target"); else { await page.waitForSelector('.language-location-picker[role="dialog"]'); await page.keyboard.press("Escape"); } assert.equal((await snap()).requests.length, 1); }
   if (cdp) { await cdp.send("HeapProfiler.collectGarbage"); console.log(`${name}: retained JS heap delta over 20 navigation/menu cycles = ${(await cdp.send("Runtime.getHeapUsage")).usedSize - heapBefore} bytes (local sample).`); }
   await reset("deferred"); await click(); await page.waitForFunction(() => window.definitionFixture.state.pending.length === 1);
   await page.evaluate(() => { window.definitionFixture.destroy(); window.definitionFixture.resolve(); }); await page.waitForTimeout(40);
   assert.equal(await page.locator('.cm-definition-link, .language-location-picker').count(), 0);
   assert.deepEqual(errors, [], `${name}: browser errors`);
   console.log(`${name}: real Ctrl/Command gestures, definitions/references, searchable 512-result picker, cross-file selection, dirty target, stale results and F12/Shift-F12 passed in ${Math.round(performance.now() - started)} ms.`);
  } catch (error) {
   console.error(name, await page.evaluate(() => ({ events: window.gestureEvents, active: window.definitionFixture?.state.active.workspacePath, requests: window.definitionFixture?.state.requests, statuses: window.definitionFixture?.state.statuses })), errors);
   throw error;
  } finally { await browser.close(); }
 }
} finally { await server.close(); }
