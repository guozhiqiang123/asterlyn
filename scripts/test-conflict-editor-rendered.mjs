import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";

// A real browser layout gate: CSS text/DOM mocks cannot detect short-file gutter truncation.
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = process.env.ASTERLYN_LAYOUT_ARTIFACTS;
if (artifacts) await mkdir(artifacts, { recursive: true });
const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: 0, hmr: false },
  plugins: [{
    name: "conflict-layout-fixture",
    configureServer(server) {
      server.middlewares.use("/__conflict_layout", (_request, response) => {
        response.setHeader("Content-Type", "text/html");
        response.end(`<!doctype html><html data-theme="dark"><head>
    <script type="module">
      import "/src/styles.css";
      import "/src/main.ts";
      window.stylesReady = true;
    </script></head><body><main id="fixture" style="height:100vh;display:grid;grid-template-rows:70px minmax(0,1fr)">
      <header>Conflict editor rendered layout regression</header>
      <div id="editor" class="content-body conflict-editor-surface"></div>
    </main></body></html>`);
      });
    },
  }],
});

try {
  await server.listen();
  const address = server.httpServer.address();
  for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
    const channel = name === "chromium" ? process.env.ASTERLYN_CHROME_CHANNEL : undefined;
    const browser = await engine.launch(channel ? { channel } : {});
    try {
      const page = await browser.newPage({ viewport: { width: 1500, height: 850 } });
      const errors = [];
      page.on("pageerror", (error) => {
        errors.push(error.message);
        console.error(`${name}: ${error.message}`);
      });
      await page.goto(`http://127.0.0.1:${address.port}/__conflict_layout`);
      await page.waitForFunction(() => window.stylesReady);
      await page.evaluate(async () => {
        const { ConflictEditor } = await import("/src/conflict-editor.ts");
        const { EditorView } = await import("/scripts/fixtures/conflict-editor-layout.ts");
        const { DEFAULT_APP_PREFERENCES } = await import("/src/preferences.ts");
        const { EN_US } = await import("/src/localization/en-US.ts");
        const editor = new ConflictEditor({
          load: async () => { throw new Error("Fixture must not request Git Blame"); },
          status() {},
          error(error) { throw error; },
        }, EN_US.editor);
        window.layoutFixture = {
          editor,
          views() {
            const left = [...document.querySelectorAll(".conflict-left-merge .cm-editor")];
            const right = [...document.querySelectorAll(".conflict-right-merge .cm-editor")];
            return [left[0], left[1], right.at(-1)]
              .map((dom) => EditorView.findFromDOM(dom));
          },
          mount(kind, theme = "dark") {
            let base = "base\n", ours = "flutter-3.38-candidate.0\n";
            let theirs = "flutter-3.47-candidate.0\n", result = "";
            if (kind === "empty") base = ours = theirs = result = "";
            if (kind === "single") result = base;
            if (kind === "long") {
              base = Array.from({ length: 800 }, (_, i) => `dependency-${i}=${"x".repeat(180)}`).join("\n");
              ours = base.replace("dependency-20=", "ours-20=");
              theirs = base.replace("dependency-20=", "theirs-20=");
              result = base;
            }
            document.documentElement.dataset.theme = theme;
            editor.setTheme(theme);
            editor.mount(document.querySelector("#editor"), {
              path: "release-candidate-branch.version", base, ours, theirs, worktree: null,
              binary: false, revisionToken: `fixture-${kind}`,
            }, result, DEFAULT_APP_PREFERENCES, { layout: "split", showWhitespace: false },
            EN_US.gitOperations, EN_US.editor, {
              ours: { source: null, unavailableReason: "Fixture" },
              theirs: { source: null, unavailableReason: "Fixture" }, unifiedReason: "Fixture",
            }, () => {});
            editor.setUnchangedExpanded(true);
          },
        };
      });

      async function settle() {
        await page.evaluate(() => new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }));
      }

      async function assertFilled(label, unified = false) {
        await settle();
        const geometry = await page.evaluate((unified) => {
          const views = window.layoutFixture.views();
          const selected = unified ? [views[1]] : views;
          return selected.map((view) => {
            const owner = view.dom.closest(".cm-mergeView");
            const viewport = owner.getBoundingClientRect();
            return {
              viewport: viewport.height,
              parts: [view.dom, view.scrollDOM, view.contentDOM,
                ...view.scrollDOM.querySelectorAll(".cm-gutters, .cm-diff-lineNumbers")]
                .map((part) => ({
                  className: part.className,
                  height: part.getBoundingClientRect().height,
                  bottom: part.getBoundingClientRect().bottom,
                })),
              bottom: viewport.bottom,
              nestedOverflow: view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight,
              background: getComputedStyle(view.dom).backgroundColor,
            };
          });
        }, unified);
        for (const pane of geometry) {
          assert.ok(pane.viewport > 200, `${label}: fixture needs a tall viewport`);
          for (const part of pane.parts) {
            assert.ok(part.height >= pane.viewport - 1,
              `${label}: ${part.className} only ${part.height}px, viewport ${pane.viewport}px`);
            assert.ok(part.bottom >= pane.bottom - 1,
              `${label}: ${part.className} ends above the viewport bottom`);
          }
          assert.ok(pane.nestedOverflow <= 1, `${label}: nested vertical scroll ownership`);
          assert.notEqual(pane.background, "rgba(0, 0, 0, 0)", `${label}: transparent editor`);
        }
        console.log(`PASS ${name}: ${label} (${geometry.map((pane) => pane.viewport).join("/")}px)`);
      }

      for (const theme of ["dark", "light"]) {
        for (const kind of ["empty", "blank-result", "single"]) {
          await page.evaluate(({ kind, theme }) => window.layoutFixture.mount(kind, theme), { kind, theme });
          await assertFilled(`${theme} ${kind}`);
          await page.setViewportSize({ width: 1100, height: 600 });
          await assertFilled(`${theme} ${kind} resized`);
          await page.setViewportSize({ width: 1500, height: 850 });
        }
      }
      await page.evaluate(() => window.layoutFixture.mount("blank-result"));
      await assertFilled("split restored after resize");
      if (artifacts) await page.screenshot({ path: `${artifacts}/${name}-short-split.png` });

      // Clicking below the text still focuses the one persistent editable Result.
      const resultScroller = page.locator(".conflict-left-merge .cm-scroller").nth(1);
      const box = await resultScroller.boundingBox();
      await page.mouse.click(box.x + 100, box.y + box.height - 60);
      assert.equal(await page.evaluate(() => window.layoutFixture.views()[1].hasFocus), true);
      await page.evaluate(() => window.layoutFixture.editor.setPresentation({ layout: "unified", showWhitespace: false }));
      await assertFilled("short unified", true);
      await page.evaluate(() => window.layoutFixture.editor.setPresentation({ layout: "split", showWhitespace: false }));
      await assertFilled("unified to split");

      await page.evaluate(() => window.layoutFixture.mount("long"));
      await settle();
      for (const top of [600, 2200, 800, 0]) {
        await page.evaluate((top) => {
          document.querySelector(".conflict-left-merge > .cm-mergeView").scrollTop = top;
        }, top);
        await page.waitForFunction((top) => {
          const left = document.querySelector(".conflict-left-merge > .cm-mergeView");
          const right = document.querySelector(".conflict-right-merge > .cm-mergeView");
          return Math.abs(left.scrollTop - top) <= 1 && Math.abs(right.scrollTop - top) <= 1;
        }, top);
        await settle();
        const nested = await page.evaluate(() => window.layoutFixture.views().map((view) => ({
          top: view.scrollDOM.scrollTop,
          overflow: view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight,
        })));
        assert.ok(nested.every((pane) => pane.top === 0 && pane.overflow <= 1),
          `${name}: long document must scroll through MergeView, not nested editors: ${JSON.stringify(nested)}`);
      }
      assert.ok(await page.locator(".conflict-scrollbars").isVisible(), "long lines retain docked horizontal scrollbars");
      console.log(`PASS ${name}: expanded long-file linked scroll and docked horizontal bars`);
      assert.deepEqual(errors, [], `${name}: no browser runtime errors`);
      await page.evaluate(() => window.layoutFixture.editor.destroy());
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
