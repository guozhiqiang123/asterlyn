import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: 0, hmr: false },
  plugins: [{
    name: "editor-patch-popover-fixture",
    configureServer(vite) {
      vite.middlewares.use("/__editor_patch_popover", (_request, response) => {
        response.setHeader("Content-Type", "text/html");
        response.end(`<!doctype html><html data-theme="dark"><head>
          <script type="module">
            import "/src/styles.css";
            import "/src/main.ts";
            window.stylesReady = true;
          </script>
        </head><body>
          <main id="editor" class="content-body" style="width:900px;height:620px"></main>
        </body></html>`);
      });
    },
  }],
});

try {
  await server.listen();
  const address = server.httpServer.address();
  for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${address.port}/__editor_patch_popover`);
      await page.waitForFunction(() => window.stylesReady);
      await page.evaluate(async () => {
        const [{ TextEditor }, { DEFAULT_APP_PREFERENCES }, { EN_US }] = await Promise.all([
          import("/src/text-editor.ts"),
          import("/src/preferences.ts"),
          import("/src/localization/en-US.ts"),
        ]);
        const host = document.querySelector("#editor");
        const createEditor = (current, baseline) => {
          const next = new TextEditor({
            load: async () => { throw new Error("Fixture must not request Git Blame"); },
            status() {},
            error(error) { throw error; },
          }, EN_US.editor);
          next.mount(
            host,
            "fixture-tab",
            1,
            current,
            baseline,
            "fixture.ts",
            DEFAULT_APP_PREFERENCES,
            null,
            null,
            () => {},
          );
          return next;
        };
        let editor = createEditor(
          "one\nnew\nmiddle\n<img onerror=alert(1)>\n",
          "one\nold\nmiddle\nkeep\n",
        );
        window.editorPatchFixture = {
          content: () => editor.content("fixture-tab"),
          readOnly: (value) => editor.setReadOnly(value),
          mountVisibleCase: () => {
            editor.destroy();
            const baseline = Array.from(
              { length: 100 },
              (_, index) => `unchanged line ${index + 1}`,
            );
            const current = [...baseline];
            current[42] = "one visible changed line";
            editor = createEditor(`${current.join("\n")}\n`, `${baseline.join("\n")}\n`);
          },
          mountBoundaryCase: () => {
            editor.destroy();
            const baseline = Array.from(
              { length: 100 },
              (_, index) => `unchanged line ${index + 1}`,
            );
            const current = [...baseline];
            for (let index = 42; index < 66; index += 1) {
              current[index] = `changed line ${index + 1} ${"content ".repeat(18)}`;
            }
            editor = createEditor(`${current.join("\n")}\n`, `${baseline.join("\n")}\n`);
          },
          destroy: () => editor.destroy(),
        };
      });

      const markers = page.locator(
        ".cm-change-indicator-gutter button.cm-change-gutter-marker",
      );
      await assertEventually(async () => await markers.count() === 2, `${name}: two markers`);
      await markers.first().click();
      await page.locator(".cm-editor-patch-popover").waitFor();
      for (const selector of [
        ".cm-editor-patch-popover",
        ".cm-editor-patch-comparison",
      ]) {
        const background = await page.locator(selector).evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        );
        assert.notEqual(background, "rgba(0, 0, 0, 0)", `${name}: ${selector} is opaque`);
        assert.notEqual(background, "transparent", `${name}: ${selector} is opaque`);
      }
      const unifiedGeometry = await page.locator(".cm-editor-patch-comparison").evaluate(
        (comparison) => ({
          comparisonWidth: comparison.getBoundingClientRect().width,
          sideWidths: Array.from(comparison.querySelectorAll(".cm-editor-patch-side"))
            .map((side) => side.getBoundingClientRect().width),
        }),
      );
      assert.equal(unifiedGeometry.sideWidths.length, 2);
      assert.ok(
        unifiedGeometry.sideWidths.every(
          (width) => width >= unifiedGeometry.comparisonWidth - 2,
        ),
        `${name}: unified Patch rows use the full comparison width`,
      );
      assert.equal(
        await page.locator(".cm-editor-patch-heading > span").textContent(),
        "1 / 2",
      );
      assert.equal(
        await page.locator(".cm-editor-patch-before code").textContent(),
        "old",
      );
      assert.equal(
        await page.locator(".cm-editor-patch-after code").textContent(),
        "new",
      );
      assert.equal(
        await page.locator('[data-editor-patch-action="previous"]').isDisabled(),
        true,
      );
      assert.ok(await page.locator(".cm-diff-current-change").count() > 0);

      await markers.first().click();
      assert.equal(await page.locator(".cm-editor-patch-popover").count(), 0);
      assert.equal(await page.locator(".cm-diff-current-change").count(), 0);
      await markers.first().click();
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(".cm-editor-patch-popover").count(), 0);
      assert.equal(await page.locator(".cm-diff-current-change").count(), 0);
      await markers.first().click();
      await page.locator(".cm-line").first().click({ position: { x: 4, y: 4 } });
      assert.equal(await page.locator(".cm-editor-patch-popover").count(), 0);
      assert.equal(await page.locator(".cm-diff-current-change").count(), 0);
      await markers.first().click();

      await page.locator('[data-editor-patch-action="next"]').click();
      assert.equal(
        await page.locator(".cm-editor-patch-heading > span").textContent(),
        "2 / 2",
      );
      assert.equal(
        await page.locator(".cm-editor-patch-before code").textContent(),
        "keep",
      );
      assert.equal(
        await page.locator(".cm-editor-patch-after code").textContent(),
        "<img onerror=alert(1)>",
      );
      assert.equal(await page.locator(".cm-editor-patch-after img").count(), 0);
      assert.equal(
        await page.locator('[data-editor-patch-action="next"]').isDisabled(),
        true,
      );

      await page.locator('[data-editor-patch-action="rollback"]').click();
      await assertEventually(
        async () => await page.evaluate(() => window.editorPatchFixture.content()) ===
          "one\nnew\nmiddle\nkeep\n",
        `${name}: selected Patch rollback`,
      );
      assert.equal(await page.locator(".cm-editor-patch-popover").count(), 0);
      assert.equal(await page.locator(".cm-diff-current-change").count(), 0);
      assert.equal(await markers.count(), 1);

      await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
      await assertEventually(
        async () => await page.evaluate(() => window.editorPatchFixture.content()) ===
          "one\nnew\nmiddle\n<img onerror=alert(1)>\n",
        `${name}: rollback participates in Undo`,
      );
      assert.equal(await markers.count(), 2);

      await page.evaluate(() => window.editorPatchFixture.readOnly(true));
      await markers.first().click();
      assert.equal(
        await page.locator('[data-editor-patch-action="rollback"]').isDisabled(),
        true,
      );
      await page.locator('[data-editor-patch-action="close"]').click();
      assert.equal(await page.locator(".cm-editor-patch-popover").count(), 0);
      assert.equal(await page.locator(".cm-diff-current-change").count(), 0);

      await page.evaluate(() => window.editorPatchFixture.mountVisibleCase());
      const scrollTopBeforeOpen = await scrollEditorTo(page, 700);
      await assertEventually(async () => await markers.count() >= 1, `${name}: visible marker`);
      await markers.first().click();
      await waitForPositionedPatch(page);
      const scrollTopAfterOpen = await page.locator(".cm-scroller").evaluate(
        (scroller) => scroller.scrollTop,
      );
      assert.ok(
        Math.abs(scrollTopAfterOpen - scrollTopBeforeOpen) <= 1,
        `${name}: opening a visible Patch preserves editor scroll position`,
      );
      await page.locator('[data-editor-patch-action="close"]').click();

      await page.evaluate(() => window.editorPatchFixture.mountBoundaryCase());
      await scrollEditorTo(page, 700);
      await assertEventually(async () => await markers.count() >= 1, `${name}: boundary marker`);
      await markers.first().click();
      await waitForPositionedPatch(page);
      const boundaryGeometry = await page.locator(".cm-editor-patch-popover").evaluate(
        (popover) => {
          const popoverBounds = popover.getBoundingClientRect();
          const scrollerBounds = document.querySelector(".cm-scroller").getBoundingClientRect();
          const headingBounds = popover.querySelector(".cm-editor-patch-heading")
            .getBoundingClientRect();
          const comparison = popover.querySelector(".cm-editor-patch-comparison");
          return {
            popoverTop: popoverBounds.top,
            popoverBottom: popoverBounds.bottom,
            scrollerTop: scrollerBounds.top,
            scrollerBottom: scrollerBounds.bottom,
            headingTop: headingBounds.top,
            headingBottom: headingBounds.bottom,
            comparisonClientHeight: comparison.clientHeight,
            comparisonScrollHeight: comparison.scrollHeight,
          };
        },
      );
      assert.ok(
        boundaryGeometry.popoverTop >= boundaryGeometry.scrollerTop + 7,
        `${name}: Patch stays below the visible editor top ${JSON.stringify(boundaryGeometry)}`,
      );
      assert.ok(
        boundaryGeometry.popoverBottom <= boundaryGeometry.scrollerBottom - 7,
        `${name}: Patch stays above the visible editor bottom`,
      );
      assert.ok(
        boundaryGeometry.headingTop >= boundaryGeometry.popoverTop &&
          boundaryGeometry.headingBottom <= boundaryGeometry.popoverBottom,
        `${name}: Patch controls remain visible`,
      );
      assert.ok(
        boundaryGeometry.comparisonScrollHeight > boundaryGeometry.comparisonClientHeight,
        `${name}: oversized Patch content scrolls inside the popup`,
      );
      assert.deepEqual(errors, [], `${name}: rendered interaction emitted page errors`);
      await page.evaluate(() => window.editorPatchFixture.destroy());
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}

async function assertEventually(predicate, label) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Timed out: ${label}`);
}

async function scrollEditorTo(page, scrollTop) {
  return await page.locator(".cm-scroller").evaluate(async (scroller, target) => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    scroller.scrollTop = target;
    scroller.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return scroller.scrollTop;
  }, scrollTop);
}

async function waitForPositionedPatch(page) {
  await page.locator(".cm-editor-patch-popover").waitFor();
  await page.waitForFunction(() =>
    document.querySelector(".cm-editor-patch-popover")?.getBoundingClientRect().top > -1_000
  );
}
