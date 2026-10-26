// Opt-in real Rust source + production editor/client/navigation/transport + real Ctrl-click.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";
const root = process.env.ASTERLYN_RUST_WORKSPACE, sysroot = process.env.ASTERLYN_RUST_SYSROOT;
assert.ok(root && sysroot, "set the explicit Rust workspace and reviewed sysroot for this opt-in acceptance");
const built = spawnSync("cargo", ["build", "--locked", "-p", "asterlyn-language-service", "--example", "rust_editor_probe"], { encoding: "utf8" });
assert.equal(built.status, 0, built.stderr);
const paths = ["src-tauri/src/application/language_service.rs", "crates/asterlyn-language-service/src/lib.rs"];
const data = { root, files: await Promise.all(paths.map(async (path) => ({ path, text: await readFile(resolve(root, path), "utf8") }))) };
const evidence = [];
for (const [name, engine] of [["Chromium", chromium], ["WebKit", webkit]]) {
 const child = spawn(resolve("target/debug/examples/rust_editor_probe"), { env: { ...process.env, ASTERLYN_RUST_WORKSPACE: root, ASTERLYN_RUST_SYSROOT: sysroot }, stdio: ["pipe", "pipe", "pipe"] });
 let stderr = "", serverPid = null, sequence = 0; const pending = new Map();
 child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2048); });
 child.stdin.on("error", () => {});
 let markReady; const ready = new Promise((done) => { markReady = done; });
 const lines = createInterface({ input: child.stdout });
 lines.on("line", (line) => { const value = JSON.parse(line); if (value.serverPid) { serverPid = value.serverPid; return; } if (value.ready) markReady(); else { pending.get(value.id)?.(value); pending.delete(value.id); } });
 const exited = new Promise((done) => child.once("exit", (code) => done(code)));
 const rpc = (value) => new Promise((done) => { const id = ++sequence; pending.set(id, done); child.stdin.write(JSON.stringify({ ...value, id }) + "\n"); });
 let chain = Promise.resolve();
 const server = await createServer({ root: process.cwd(), server: { host: "127.0.0.1", port: 0, hmr: false }, plugins: [{ name: "live-rust", configureServer(vite) {
   vite.middlewares.use("/__rust/data", (_req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data)); });
   vite.middlewares.use("/__rust/rpc", (req, res) => {
     let body = ""; req.on("data", (chunk) => { body += chunk; }); req.on("end", () => {
       chain = chain.then(async () => { const value = await rpc(JSON.parse(body)); res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); });
     });
   });
   vite.middlewares.use("/__rust", (_req, res) => { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html><body><main id="editor" style="width:1000px;height:600px"></main><script type="module" src="/scripts/fixtures/rust-language-navigation-fixture.ts"></script></body></html>'); });
 } }] });
 let browser, page; const timeout = setTimeout(() => child.kill("SIGKILL"), 120000);
 try {
   await Promise.race([ready, exited.then(() => { throw Error(`Rust probe ended: ${stderr}`); })]);
   await server.listen(); const port = server.httpServer.address().port;
   browser = await engine.launch(); page = await browser.newPage(); const errors = [];
   page.on("pageerror", (error) => errors.push(error.message)); page.setDefaultTimeout(60000);
   await page.goto(`http://127.0.0.1:${port}/__rust`, { waitUntil: "networkidle" });
   await page.waitForFunction(() => Boolean(window.rustFixture));
   await page.evaluate(() => window.rustFixture.point()); await page.waitForTimeout(100);
   const point = await page.evaluate(() => window.rustFixture.coords());
   await page.mouse.move(point.x, point.y);
   await page.evaluate(() => { window.rustEvents = []; for (const type of ["mousedown", "mouseup", "blur", "contextmenu"]) document.addEventListener(type, (event) => window.rustEvents.push({ type, ctrl: event.ctrlKey, button: event.button, target: event.target?.nodeName }), true); });
   const started = performance.now(); await page.keyboard.down("Control"); await page.waitForSelector(".cm-definition-link", { timeout: 3000 }); const hit = await page.locator(".cm-definition-link").boundingBox(); await page.mouse.click(hit.x + hit.width / 2, hit.y + hit.height / 2); await page.keyboard.up("Control");
   await page.waitForFunction(() => window.rustFixture.state.active.path === "crates/asterlyn-language-service/src/lib.rs", null, { timeout: 45000 });
   assert.equal(await page.evaluate(() => window.rustFixture.selection()), "start");
   assert.deepEqual(await page.evaluate(() => window.rustFixture.state.reviews), ["rust-analyzer"]);
   assert.ok((await page.evaluate(() => window.rustFixture.state.requests)).includes("textDocument/definition"));
   assert.deepEqual(await page.evaluate(() => window.rustFixture.state.errors), []); assert.deepEqual(errors, []);
   const coldMs = Math.round(performance.now() - started);
   await page.evaluate(() => { window.rustFixture.source(); window.rustFixture.point(); }); await page.waitForTimeout(100);
   const warmPoint = await page.evaluate(() => window.rustFixture.coords());
   await page.mouse.move(warmPoint.x, warmPoint.y); const warmed = performance.now();
   await page.keyboard.down("Control"); await page.waitForSelector(".cm-definition-link");
   const warmHit = await page.locator(".cm-definition-link").boundingBox();
   await page.mouse.click(warmHit.x + warmHit.width / 2, warmHit.y + warmHit.height / 2); await page.keyboard.up("Control");
   await page.waitForFunction(() => window.rustFixture.state.active.path === "crates/asterlyn-language-service/src/lib.rs");
   assert.equal(await page.evaluate(() => window.rustFixture.selection()), "start");
   assert.equal(await page.evaluate(() => window.rustFixture.state.starts), 1, "switching open Rust tabs must reuse the native session");
   evidence.push({ engine: name, realServer: "rust-analyzer 1.98.1", source: paths[0], target: paths[1], selection: "start", gesture: "Control+left-click", elapsedMs: coldMs, warmMs: Math.round(performance.now() - warmed), sessionStarts: 1 });
   await page.evaluate(() => window.rustFixture.dispose());
 } catch (error) {
   console.error(name, await page?.evaluate(() => ({ state: window.rustFixture?.state, selection: window.rustFixture?.selection(), point: window.rustFixture?.coords(), events: window.rustEvents })), stderr);
   throw error;
 } finally {
   await browser?.close(); await server.close(); child.stdin.end();
   const stop = setTimeout(() => child.kill("SIGKILL"), 3000); await exited; if (serverPid) { try { process.kill(-serverPid, "SIGKILL"); } catch {} } clearTimeout(stop); clearTimeout(timeout); lines.close();
 }
}
for (const file of data.files) assert.equal(await readFile(resolve(root, file.path), "utf8"), file.text, "acceptance must not change project sources on disk");
await writeFile("/tmp/asterlyn-rust-rendered-evidence.json", JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence));
