import assert from "node:assert/strict";
import {chromium, webkit} from "playwright";
import {createServer} from "vite";

const server = await createServer({root: process.cwd(), cacheDir: "node_modules/.vite-diff-reactivation", server: {host: "127.0.0.1", port: 0, hmr: false}, plugins: [{name: "diff-reactivation", configureServer(vite) {vite.middlewares.use("/__reactivation", (_req, res) => {
  res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html data-theme="dark"><body><button id="file" data-change-path="feature.ts">feature.ts</button><main id="fixture"><div id="content-body" class="content-body" style="width:1000px;height:600px"></div></main><script type="module" src="/scripts/fixtures/diff-reactivation-fixture.ts"></script></body></html>');
});}}]});
try {
  await server.listen();
  for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({viewport: {width: 1100, height: 760}}), errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__reactivation`);
      await page.waitForFunction(() => window.reactivation);
      const call = (method, ...args) => page.evaluate(([method, args]) => window.reactivation[method](...args), [method, args]);
      for (const kind of ["working-editable", "working-readonly", "history"]) {
        await call("reset", kind, true);
        for (let i = 0; i < 5; i++) await page.locator("#file").click();
        let stats = await call("snapshot");
        assert.equal(kind === "history" ? stats.commitReads : stats.reads, 1, `${name}/${kind}: pending clicks share one request`);
        await call("release");
        await page.waitForSelector(".cm-editor");
        if (kind === "working-editable") await page.waitForSelector(".editable-diff-surface .cm-editor");
        await page.waitForTimeout(100);
        const baseline = await call("remember");
        for (let i = 0; i < 20; i++) await page.locator("#file").click();
        stats = await call("snapshot");
        assert.equal(stats.sameNodes, true, `${name}/${kind}: existing CodeMirror nodes survive`);
        assert.deepEqual(stats.scrolls, stats.expectedScrolls, `${name}/${kind}: scroll remains stable`);
        assert.deepEqual(stats.selection, stats.expectedSelection, `${name}/${kind}: cursor remains stable`);
        assert.equal(stats.loading, baseline.loading, `${name}/${kind}: no loading flash`);
        assert.equal(stats.renders, baseline.renders, `${name}/${kind}: no redundant render`);
        assert.equal(stats.activations, baseline.activations, `${name}/${kind}: no redundant activation`);
        assert.equal(stats.backingReads, baseline.backingReads, `${name}/${kind}: no background buffer reload`);
        if (kind === "working-editable") {
          await call("edit"); await page.locator("#file").click();
          assert.ok((await call("snapshot")).text.startsWith("// unsaved"));
          await call("undo"); await page.waitForFunction(() => !window.reactivation.snapshot().text.startsWith("// unsaved"));
        }
        if (kind.startsWith("working")) {
          await call("refresh");
          await page.waitForFunction(() => window.reactivation.snapshot().reads === 2);
        } else {
          await call("leave"); await page.locator("#file").click();
          await page.waitForFunction(() => window.reactivation.snapshot().commitReads === 2);
          await call("commit"); await page.locator("#file").click();
          await page.waitForFunction(() => window.reactivation.snapshot().commitReads === 3);
          await call("fail"); await page.locator("#file").click();
          await page.waitForFunction(() => window.reactivation.snapshot().commitReads === 4);
        }
      }
      assert.deepEqual(errors, []);
      await call("dispose");
      console.log(`PASS ${name}: Changes editable/read-only and History repeated/pending clicks preserve DOM, scroll, selection and undo; refresh/commit switch/retry still load`);
    } finally {await browser.close();}
  }
} finally {await server.close();}
