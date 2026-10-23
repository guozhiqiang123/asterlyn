import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const longDocument = await readFile(new URL(import.meta.url), "utf8");
const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: 0, hmr: false },
  plugins: [{
    name: "diff-layout-fixture",
    configureServer(server) {
      server.middlewares.use("/__diff_layout", (_request, response) => {
        response.setHeader("Content-Type", "text/html");
        response.end(`<!doctype html><html data-theme="dark"><head>
    <script type="module">
      import "/src/styles.css";
      import "/src/main.ts";
      window.stylesReady = true;
    </script></head><body>
      <main id="fixture" style="height:100vh;display:grid;grid-template-rows:42px minmax(0,1fr)">
        <header>Two-pane Diff rendered layout regression</header>
        <div id="editor" class="content-body diff-surface"></div>
      </main>
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
      const page = await browser.newPage({ viewport: { width: 1500, height: 850 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${address.port}/__diff_layout`);
      await page.waitForFunction(() => window.stylesReady);
      await page.evaluate(async (longDocument) => {
        const [{ DiffEditor }, { EditableDiffEditor }, { LazyDiffEditor }, { DEFAULT_APP_PREFERENCES }, { EN_US }] =
          await Promise.all([
            import("/src/diff-editor.ts"),
            import("/src/editable-diff-editor.ts"),
            import("/src/features/files-editor/lazy-editor-runtime.ts"),
            import("/src/preferences.ts"),
            import("/src/localization/en-US.ts"),
          ]);
        const host = document.querySelector("#editor");
        const unavailable = {
          old: { source: null, unavailableReason: "Fixture" },
          new: { source: null, unavailableReason: "Fixture" },
          unifiedReason: "Fixture",
        };
        const blame = {
          load: async () => { throw new Error("Fixture must not request Git Blame"); },
          status() {},
          error(error) { throw error; },
        };
        let active = null;
        const long = "x".repeat(320);
        const sectionedBefore = Array.from({ length: 394 }, (_, index) => `line ${index + 1}`);
        const sectionedAfter = [...sectionedBefore];
        for (let line = 11; line <= 255; line += 1) {
          sectionedAfter[line - 1] = `changed ${line}`;
        }
        sectionedAfter[390] = "changed 391";
        const sectionedHunk = (from, to) => {
          const lines = [`@@ -${from},${to - from + 1} +${from},${to - from + 1} @@`];
          for (let line = from; line <= to; line += 1) {
            if (sectionedAfter[line - 1] !== sectionedBefore[line - 1]) {
              lines.push(`-${sectionedBefore[line - 1]}`, `+${sectionedAfter[line - 1]}`);
            } else {
              lines.push(` ${sectionedBefore[line - 1]}`);
            }
          }
          return lines;
        };
        const compactSectionedPatch = [
          ...sectionedHunk(8, 258),
          ...sectionedHunk(388, 394),
        ].join("\n");
        const fullSectionedPatch = sectionedHunk(1, 394).join("\n");
        window.diffLayoutFixture = {
          mountReadOnly() {
            active?.destroy();
            host.className = "content-body diff-surface";
            const editor = new DiffEditor(blame, EN_US.editor);
            editor.mount(
              host,
              `diff --git a/fixture.ts b/fixture.ts\n--- a/fixture.ts\n+++ b/fixture.ts\n@@ -1,2 +1,2 @@\n-old ${long}\n+new ${long}\n context\n`,
              "fixture.ts",
              DEFAULT_APP_PREFERENCES,
              { layout: "split", showWhitespace: false, splitPercentage: 37 },
              { before: "Before", after: "After" },
              unavailable,
              () => {},
            );
            active = editor;
          },
          mountSectionedReadOnly(layout) {
            active?.destroy();
            const expanded = new Set();
            const editor = new LazyDiffEditor(blame, EN_US.editor);
            const mount = () => {
              host.className = "content-body diff-surface";
              host.innerHTML = "";
              editor.mount(
                host,
                expanded.size > 0 ? fullSectionedPatch : compactSectionedPatch,
                "sectioned.ts",
                DEFAULT_APP_PREFERENCES,
                {
                  layout,
                  showWhitespace: false,
                  expandedUnchangedSections: [...expanded],
                },
                { before: "Before", after: "After" },
                unavailable,
                (section) => {
                  expanded.add(section);
                  editor.destroy();
                  host.innerHTML = "<div>Loading expanded context</div>";
                  queueMicrotask(mount);
                },
              );
              active = editor;
            };
            mount();
          },
          mountEditable(before = `old ${long}\ncontext\n`, after = `new ${long}\ncontext\n`) {
            active?.destroy();
            host.className = "content-body diff-surface editable-diff-surface";
            const editor = new EditableDiffEditor(EN_US.editor, blame);
            editor.mount(
              host,
              before,
              after,
              "fixture.ts",
              DEFAULT_APP_PREFERENCES,
              { layout: "split", showWhitespace: false, editableSplitPercentage: 42 },
              { before: "Before", after: "After" },
              unavailable,
              true,
              () => {},
            );
            active = editor;
          },
          mountLongEditable() { this.mountEditable("", longDocument); },
          destroy() { active?.destroy(); },
        };
      }, longDocument);

      const settle = async () => {
        await page.evaluate(() => new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }));
      };
      const close = (actual, expected, label) => {
        assert.ok(Math.abs(actual - expected) <= 1, `${name}: ${label}: ${actual} != ${expected}`);
      };

      await page.evaluate(() => window.diffLayoutFixture.mountReadOnly());
      await settle();
      const readOnly = await page.evaluate(() => {
        const rect = (selector) => {
          const value = document.querySelector(selector).getBoundingClientRect();
          return {
            left: value.left,
            right: value.right,
            top: value.top,
            bottom: value.bottom,
            width: value.width,
            height: value.height,
          };
        };
        const footer = document.querySelector(".diff-readonly-scrollbars");
        const divider = document.querySelector(".diff-readonly-scrollbar-divider");
        const splitter = document.querySelector(".diff-splitter");
        return {
          oldPane: rect(".diff-pane-old"),
          split: rect(".diff-splitter"),
          newPane: rect(".diff-pane-new"),
          beforeBar: rect(".diff-readonly-scrollbar-before"),
          footerDivider: rect(".diff-readonly-scrollbar-divider"),
          afterBar: rect(".diff-readonly-scrollbar-after"),
          borderTop: getComputedStyle(footer).borderTopWidth,
          dividerBorders: [
            getComputedStyle(divider).borderLeftWidth,
            getComputedStyle(divider).borderRightWidth,
          ],
          splitterLine: {
            top: getComputedStyle(splitter, "::after").top,
            bottom: getComputedStyle(splitter, "::after").bottom,
            left: getComputedStyle(splitter, "::after").left,
          },
        };
      });
      close(readOnly.oldPane.right, readOnly.beforeBar.right, "read-only before boundary");
      close(
        (readOnly.split.left + readOnly.split.right) / 2,
        (readOnly.footerDivider.left + readOnly.footerDivider.right) / 2,
        "read-only splitter center",
      );
      close(readOnly.newPane.left, readOnly.afterBar.left, "read-only after boundary");
      close(readOnly.oldPane.bottom, readOnly.beforeBar.top, "read-only footer docking");
      close(readOnly.oldPane.top, readOnly.split.top, "read-only splitter top");
      close(readOnly.oldPane.bottom, readOnly.split.bottom, "read-only splitter bottom");
      assert.equal(readOnly.split.width, 13);
      assert.deepEqual(readOnly.splitterLine, { top: "0px", bottom: "0px", left: "6px" });
      assert.equal(readOnly.borderTop, "1px");
      assert.deepEqual(readOnly.dividerBorders, ["1px", "1px"]);

      await page.hover(".diff-splitter");
      await page.waitForTimeout(150);
      assert.equal(await page.$eval(
        ".diff-splitter",
        (element) => getComputedStyle(element, "::after").opacity,
      ), "1");
      const readOnlySplitter = await page.locator(".diff-splitter").boundingBox();
      await page.mouse.move(readOnlySplitter.x + readOnlySplitter.width / 2, readOnlySplitter.y + 80);
      await page.mouse.down();
      await page.mouse.move(readOnlySplitter.x + 102, readOnlySplitter.y + 80);
      await page.mouse.up();
      await settle();
      assert.ok(parseFloat(await page.$eval(
        ".diff-split-grid",
        (element) => element.style.getPropertyValue("--diff-before-width"),
      )) > 37);

      for (const layout of ["split", "unified"]) {
        await page.evaluate((value) => window.diffLayoutFixture.mountSectionedReadOnly(value), layout);
        await settle();
        const selector = layout === "split"
          ? ".diff-pane-new .cm-source-omitted"
          : ".cm-source-omitted";
        const scroller = layout === "split"
          ? ".diff-pane-new .cm-scroller"
          : ".diff-unified-grid .cm-scroller";
        await page.$eval(scroller, (element) => { element.scrollTop = element.scrollHeight; });
        await settle();
        const omitted = page.locator(selector, { hasText: "129 unchanged lines omitted" });
        assert.equal(await omitted.count(), 1, `${name}: ${layout} renders the selected omitted section`);
        const clickedTop = (await omitted.boundingBox()).y;
        await omitted.evaluate((element) => element.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        })));
        await settle();
        await page.waitForTimeout(150);
        const expandedPosition = await page.evaluate((scrollerSelector) => {
          const scroll = document.querySelector(scrollerSelector);
          const line = [...document.querySelectorAll(".cm-line")]
            .find((element) => element.textContent?.includes("line 259"));
          return {
            top: line?.getBoundingClientRect().top ?? null,
            scrollTop: scroll?.scrollTop ?? null,
            scrollMaximum: scroll ? scroll.scrollHeight - scroll.clientHeight : null,
            visible: [...document.querySelectorAll(".cm-line")].slice(0, 4)
              .map((element) => element.textContent),
          };
        }, scroller);
        assert.notEqual(expandedPosition.top, null,
          `${name}: ${layout} lost source-line anchor ${JSON.stringify(expandedPosition)}`);
        const expandedTop = expandedPosition.top;
        assert.ok(Math.abs(expandedTop - clickedTop) <= 2,
          `${name}: ${layout} expanded away from the clicked row ${JSON.stringify({
            clickedTop,
            expandedTop,
            expandedPosition,
          })}`);
      }

      await page.evaluate(() => window.diffLayoutFixture.mountEditable());
      await settle();
      const editable = await page.evaluate(() => {
        const rect = (selector) => {
          const value = document.querySelector(selector).getBoundingClientRect();
          return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width };
        };
        const footer = document.querySelector(".editable-diff-scrollbars");
        const spacer = document.querySelector(".editable-diff-scrollbar-spacer");
        const editors = document.querySelectorAll(".cm-mergeViewEditor");
        const editorRect = (element) => {
          const value = element.getBoundingClientRect();
          return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width };
        };
        return {
          beforeEditor: editorRect(editors[0]),
          actionGutter: rect(".cm-merge-revert"),
          afterEditor: editorRect(editors[1]),
          beforeBar: rect(".editable-diff-scrollbar-a"),
          footerSpacer: rect(".editable-diff-scrollbar-spacer"),
          afterBar: rect(".editable-diff-scrollbar-b"),
          splitter: rect(".editable-diff-splitter"),
          borderTop: getComputedStyle(footer).borderTopWidth,
          spacerBorders: [
            getComputedStyle(spacer).borderLeftWidth,
            getComputedStyle(spacer).borderRightWidth,
          ],
        };
      });
      close(editable.beforeEditor.right, editable.beforeBar.right, "editable before boundary");
      close(editable.actionGutter.left, editable.footerSpacer.left, "editable gutter start");
      close(editable.actionGutter.right, editable.footerSpacer.right, "editable gutter end");
      close(editable.afterEditor.left, editable.afterBar.left, "editable after boundary");
      close(editable.beforeEditor.bottom, editable.beforeBar.top, "editable footer docking");
      close(editable.actionGutter.left, editable.splitter.left, "editable drag target start");
      close(editable.actionGutter.right, editable.splitter.right, "editable drag target end");
      assert.equal(editable.borderTop, "1px");
      assert.deepEqual(editable.spacerBorders, ["1px", "1px"]);

      // The connector's SVG is positioned inside the host's padding box. A bordered host must
      // not shift it away from the action gutter, even though DOM rectangles include borders.
      for (const theme of ["light", "dark"]) {
        for (const border of [0, 1, 2]) {
          await page.evaluate(({ theme, border }) => {
            document.documentElement.dataset.theme = theme;
            document.querySelector("#editor").style.border = `${border}px solid transparent`;
          }, { theme, border });
          await settle();
          const connector = await page.evaluate(() => {
            const svg = document.querySelector(".diff-review-overlay");
            const frame = svg.getBoundingClientRect();
            const path = svg.querySelector("path").getBBox();
            const lane = document.querySelector(".cm-merge-revert").getBoundingClientRect();
            const viewport = document.querySelector(".cm-mergeView").getBoundingClientRect();
            return {
              leftGap: frame.left + path.x - lane.left,
              rightGap: frame.left + path.x + path.width - lane.right,
              frameLeftGap: frame.left - viewport.left,
              frameTopGap: frame.top - viewport.top,
            };
          });
          for (const [edge, gap] of Object.entries(connector)) {
            assert.ok(Math.abs(gap) <= 0.05,
              `${name}: ${theme} ${border}px border: connector ${edge} is displaced by ${gap}px`);
          }
        }
      }
      await page.evaluate(() => {
        document.querySelector("#editor").style.removeProperty("border");
        document.documentElement.dataset.theme = "dark";
      });
      await settle();

      // Bounding boxes alone miss a zero-height cusp: it reaches both horizontal endpoints
      // while leaving the empty side of an addition/deletion visibly unfilled beside the button.
      const additions = [
        ["middle", "head\ntail\n", "head\nadded one\nadded two\nadded three\ntail\n"],
        ["start", "tail\n", "added one\nadded two\ntail\n"],
        ["end", "head\n", "head\nadded one\nadded two\n"],
        ["empty-file", "", "added one\nadded two\n"],
      ];
      for (const theme of ["light", "dark"]) {
        for (const [location, before, after] of additions) {
          for (const direction of ["addition", "deletion"]) {
            await page.evaluate(({ theme, before, after, direction }) => {
              document.documentElement.dataset.theme = theme;
              window.diffLayoutFixture.mountEditable(
                direction === "addition" ? before : after,
                direction === "addition" ? after : before,
              );
            }, { theme, before, after, direction });
            await settle();
            const fill = await page.evaluate((direction) => {
              const svg = document.querySelector(".diff-review-overlay");
              const path = svg.querySelector("path");
              const lane = document.querySelector(".cm-merge-revert").getBoundingClientRect();
              const panes = document.querySelectorAll(".cm-mergeViewEditor");
              const changedPane = panes[direction === "addition" ? 1 : 0];
              const changedLines = [...changedPane.querySelectorAll(".cm-changedLine")];
              const inverse = path.getScreenCTM().inverse();
              const points = changedLines.flatMap((line) => {
                const rect = line.getBoundingClientRect();
                return [lane.left + 1.1, lane.right - 1.1].map((x) => ({
                  x, y: (rect.top + rect.bottom) / 2,
                }));
              });
              return {
                samples: points.map(({ x, y }) => path.isPointInFill(new DOMPoint(x, y).matrixTransform(inverse))),
                unchangedTops: [...document.querySelectorAll(".cm-line")]
                  .filter((line) => line.textContent === "tail")
                  .map((line) => line.getBoundingClientRect().top),
              };
            }, direction);
            assert.ok(fill.samples.length >= 2, `${name}: ${location} ${direction}: missing changed lines`);
            assert.ok(fill.samples.every(Boolean),
              `${name}: ${theme} ${location} ${direction}: connector leaves an unfilled gutter edge ${JSON.stringify(fill.samples)}`);
            if (fill.unchangedTops.length === 2) close(...fill.unchangedTops, `${location} ${direction}: unchanged line alignment`);
          }
        }
      }
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
        window.diffLayoutFixture.mountEditable();
      });
      await settle();

      await page.hover(".editable-diff-splitter");
      await page.waitForTimeout(150);
      assert.equal(await page.$eval(
        ".editable-diff-splitter",
        (element) => getComputedStyle(element, "::after").opacity,
      ), "1");
      const editableSplitter = await page.locator(".editable-diff-splitter").boundingBox();
      await page.mouse.move(editableSplitter.x + 6, editableSplitter.y + 80);
      await page.mouse.down();
      await page.mouse.move(editableSplitter.x + 106, editableSplitter.y + 80);
      await page.mouse.up();
      await settle();
      assert.ok(parseFloat(await page.$eval(
        "#editor",
        (element) => element.style.getPropertyValue("--diff-before-width"),
      )) > 42);
      await page.locator(".editable-diff-revert").click();
      await settle();
      assert.match(await page.locator(".cm-mergeViewEditor").last().innerText(), /old x+/,
        `${name}: splitter must leave the revert button clickable`);

      await page.evaluate(() => window.diffLayoutFixture.mountLongEditable());
      await settle();
      const visibleSplitter = async (label) => {
        const geometry = await page.evaluate(() => {
          const merge = document.querySelector(".cm-mergeView");
          const splitter = document.querySelector(".editable-diff-splitter");
          const header = document.querySelector(".diff-side-labels").getBoundingClientRect();
          const viewport = merge.getBoundingClientRect();
          const rect = splitter.getBoundingClientRect();
          const x = rect.left + 6;
          const topY = header.bottom + 30;
          const y = viewport.bottom - 30;
          return {
            scrollTop: merge.scrollTop,
            viewportTop: header.bottom,
            viewportBottom: viewport.bottom,
            splitterTop: rect.top,
            splitterBottom: rect.bottom,
            topHit: document.elementFromPoint(x, topY)?.className,
            bottomHit: document.elementFromPoint(x, y)?.className,
            x,
            y,
          };
        });
        assert.ok(geometry.splitterTop <= geometry.viewportTop,
          `${name}: ${label}: splitter must reach the top of the visible code`);
        assert.ok(geometry.splitterBottom >= geometry.viewportBottom - 1,
          `${name}: ${label}: splitter ends at ${geometry.splitterBottom}, before viewport bottom ${geometry.viewportBottom}`);
        assert.match(geometry.topHit, /editable-diff-splitter/, `${name}: ${label}: upper drag target`);
        assert.match(geometry.bottomHit, /editable-diff-splitter/, `${name}: ${label}: lower drag target`);
        const filled = await page.evaluate(() => {
          const path = document.querySelector(".diff-review-overlay path");
          if (!path) return false;
          const lane = document.querySelector(".cm-merge-revert").getBoundingClientRect();
          const viewport = document.querySelector(".cm-mergeView").getBoundingClientRect();
          const inverse = path.getScreenCTM().inverse();
          return [lane.left + 1.1, lane.right - 1.1].every((x) => path.isPointInFill(
            new DOMPoint(x, (viewport.top + viewport.bottom) / 2).matrixTransform(inverse),
          ));
        });
        assert.ok(filled, `${name}: ${label}: long addition must keep both visible connector edges filled`);
        return geometry;
      };
      for (const location of ["300px", "middle", "end"]) {
        await page.$eval(".cm-mergeView", (element, location) => {
          const maximum = element.scrollHeight - element.clientHeight;
          element.scrollTop = location === "300px" ? 300 : maximum * (location === "middle" ? 0.5 : 1);
        }, location);
        await settle();
        const scrolled = await visibleSplitter(location);
        assert.ok(scrolled.scrollTop > 0, `${name}: long fixture must actually scroll`);
        if (location === "300px") {
          assert.equal(scrolled.scrollTop, 300);
          await page.mouse.move(scrolled.x, scrolled.y);
          await page.mouse.wheel(0, 200);
          await page.waitForFunction(() => document.querySelector(".cm-mergeView").scrollTop > 300);
          await visibleSplitter("wheel over splitter");
        }
      }
      await page.setViewportSize({ width: 1180, height: 620 });
      await settle();
      const scrolled = await visibleSplitter("resized at file end");
      await page.mouse.move(scrolled.x, scrolled.y);
      await page.mouse.down();
      await page.mouse.move(scrolled.x + 90, scrolled.y);
      await page.mouse.up();
      await settle();
      assert.ok(parseFloat(await page.$eval(
        "#editor",
        (element) => element.style.getPropertyValue("--diff-before-width"),
      )) > 42, `${name}: drag after scrolling must resize the panes`);
      assert.deepEqual(errors, [], `${name}: no browser runtime errors`);
      await page.evaluate(() => window.diffLayoutFixture.destroy());
      console.log(`PASS ${name}: Diff footer alignment, 16 themed addition/deletion fill cases, splitters, revert, and long-file connector/dragging after scroll/resize`);
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
