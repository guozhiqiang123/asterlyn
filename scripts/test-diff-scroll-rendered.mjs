import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({root, server: {host: "127.0.0.1", port: 0, hmr: false}, plugins: [{
  name: "diff-scroll-fixture",
  configureServer(server) {
    server.middlewares.use("/__diff_scroll", (_request, response) => {
      response.setHeader("Content-Type", "text/html");
      response.end('<html data-theme="dark"><head><script type="module">import "/src/styles.css";import "/src/main.ts";window.stylesReady=true;</script></head><body style="margin:0"><div id="host" class="content-body diff-surface editable-diff-surface" style="height:100vh;width:100vw"></div></body></html>');
    });
  },
}]});
const evidence = [];
try {
  await server.listen();
  for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({viewport: {width: 1460, height: 850}});
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__diff_scroll`);
      await page.waitForFunction(() => window.stylesReady);
      await page.evaluate(async () => {
        const [{EditableDiffEditor}, {DiffEditor}, {EditorView, undo}, {DEFAULT_APP_PREFERENCES}, {EN_US}] = await Promise.all([
          import("/src/editable-diff-editor.ts"), import("/src/diff-editor.ts"), import("/scripts/fixtures/diff-scroll-modules.ts"),
          import("/src/preferences.ts"), import("/src/localization/en-US.ts"),
        ]);
        const host = document.querySelector("#host");
        const missing = {source: null, unavailableReason: "Scroll fixture"};
        const sources = {old: missing, new: missing, unifiedReason: "Scroll fixture"};
        const blame = {load: async () => {throw Error("Unexpected blame request");}, status() {}, error(error) {throw error;}};
        let active, original, editors, samples = [], sampling = false;
        const views = () => [...host.querySelectorAll(".cm-editor")].map((dom) => EditorView.findFromDOM(dom));
        window.scrollFixture = {
          mount(kind, count) {
            active?.destroy(); host.replaceChildren();
            host.className = `content-body diff-surface${kind === "editable" ? " editable-diff-surface" : ""}`;
            const before = Array.from({length: count}, (_, i) => `export const value_${i} = "original ${i}";`);
            const after = before.map((line, i) => i % 80 === 20 ? `export const value_${i} = "changed ${i}";` : line);
            original = after.join("\n");
            const presentation = {layout: "split", showWhitespace: false, editableSplitPercentage: 42};
            const labels = {before: "Before", after: "After"};
            if (kind === "editable") {
              active = new EditableDiffEditor(EN_US.editor, blame);
              active.mount(host, before.join("\n"), original, "fixture.ts", DEFAULT_APP_PREFERENCES, presentation, labels, sources, true, () => {});
            } else {
              const patch = `diff --git a/fixture.ts b/fixture.ts\n--- a/fixture.ts\n+++ b/fixture.ts\n@@ -1,${count} +1,${count} @@\n${before.map((line, i) => line === after[i] ? ` ${line}` : `-${line}\n+${after[i]}`).join("\n")}\n`;
              active = new DiffEditor(blame, EN_US.editor);
              active.mount(host, patch, "fixture.ts", DEFAULT_APP_PREFERENCES, presentation, labels, sources, () => {});
            }
            editors = [...host.querySelectorAll(".cm-editor")];
          },
          sample() {
            const bounds = host.getBoundingClientRect();
            return views().map((view) => {
              const lines = [...view.contentDOM.querySelectorAll(".cm-line")];
              const visible = lines.filter((node) => {const r = node.getBoundingClientRect(); return r.bottom > bounds.top + 35 && r.top < bounds.bottom - 20;}).length;
              const first = view.state.doc.lineAt(view.viewport.from).from;
              const last = view.state.doc.lineAt(view.viewport.to).to;
              return {mounted: lines.length, visible, blocks: view.viewportLineBlocks.length,
                outside: view.viewportLineBlocks.filter((b) => b.from < first || b.to > last).length,
                gutters: view.dom.querySelectorAll(".cm-gutterElement").length,
                top: view.scrollDOM.scrollTop || host.querySelector(".cm-mergeView")?.scrollTop || 0};
            });
          },
          start() {
            samples = []; sampling = true; let previous = performance.now();
            const tick = (time) => {if (!sampling) return; samples.push({dt: time - previous, panes: this.sample()}); previous = time; requestAnimationFrame(tick);};
            requestAnimationFrame(tick);
          },
          finish() {sampling = false; return {samples, sameEditors: editors.every((node, i) => host.querySelectorAll(".cm-editor")[i] === node)};},
          async checkConnectorIdentity() {
            const previous = host.querySelector(".diff-review-connector");
            host.dispatchEvent(new Event("scroll"));
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return !!previous && host.contains(previous);
          },
          checkUndo() {
            const view = views().at(-1);
            view.dispatch({changes: {from: 0, insert: "// scroll regression\n"}});
            undo(view);
            return view.state.doc.toString() === original;
          },
        };
        await document.fonts.ready;
      });
      for (const [kind, lines] of [["editable", 3000], ["editable", 10000], ["editable", 30000], ["history", 10000]]) {
        await page.evaluate(([kind, lines]) => window.scrollFixture.mount(kind, lines), [kind, lines]);
        await page.waitForTimeout(600);
        const initial = await page.evaluate(() => window.scrollFixture.sample());
        assert.equal(initial.length, 2);
        for (const pane of initial) {
          assert.equal(pane.outside, 0, `${name} ${kind} ${lines}: gutter viewport must not escape the code viewport`);
          assert.ok(pane.gutters < 600, `${name} ${kind} ${lines}: unexpected ${pane.gutters} gutter elements`);
        }
        if (kind === "editable") assert.equal(await page.evaluate(() => window.scrollFixture.checkConnectorIdentity()), true);
        await page.mouse.move(1100, 450);
        await page.evaluate(() => window.scrollFixture.start());
        for (let step = 0; step < 36; step++) {await page.mouse.wheel(0, step < 24 ? 650 : -650); await page.waitForTimeout(20);}
        await page.waitForTimeout(100);
        const {samples, sameEditors} = await page.evaluate(() => window.scrollFixture.finish());
        assert.ok(sameEditors, `${name}: scrolling must preserve editor instances`);
        assert.ok(samples.some((s) => s.panes.some((p) => p.top > 10000)), `${name}: fixture must actually scroll`);
        assert.ok(samples.length > 20);
        const frames = samples.map((s) => s.dt).sort((a, b) => a - b);
        const p95 = frames[Math.floor(frames.length * 0.95)];
        const maxGutters = Math.max(...samples.flatMap((s) => s.panes.map((p) => p.gutters)));
        assert.ok(maxGutters < 600, `${name} ${kind}: gutter count grew to ${maxGutters}`);
        assert.equal(samples.filter((s) => s.panes.some((p) => p.outside || p.visible === 0)).length, 0, `${name} ${kind}: blank or escaped viewport`);
        assert.ok(p95 < 50, `${name} ${kind} ${lines}: P95 ${p95.toFixed(1)}ms exceeds 50ms`);
        if (kind === "editable") assert.equal(await page.evaluate(() => window.scrollFixture.checkUndo()), true);
        evidence.push({engine: name, kind, lines, frames: samples.length, p95, max: frames.at(-1), maxGutters});
        console.log(`PASS ${name} ${kind} ${lines} lines: P95 ${p95.toFixed(1)}ms, max ${frames.at(-1).toFixed(1)}ms, gutters <= ${maxGutters}, no sampled blank frames`);
      }
      assert.deepEqual(errors, []);
    } finally {await browser.close();}
  }
  if (process.env.ASTERLYN_SCROLL_EVIDENCE) await writeFile(process.env.ASTERLYN_SCROLL_EVIDENCE, JSON.stringify(evidence, null, 2));
} finally {await server.close();}
