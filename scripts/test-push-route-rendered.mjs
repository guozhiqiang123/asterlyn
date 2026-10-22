import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: 0, hmr: false },
  plugins: [{
    name: "push-route-layout-fixture",
    configureServer(vite) {
      vite.middlewares.use("/__push_route", (_request, response) => {
        response.setHeader("Content-Type", "text/html");
        response.end(`<!doctype html><html data-theme="dark"><head>
          <script type="module">
            import "/src/styles.css";
            import "/src/shared/select-control.css";
            import "/src/features/remote-push/remote-push.css";
            import "/src/features/remote-push/push-dialog-layout.css";
            window.stylesReady = true;
          </script>
        </head><body>
          <div class="push-route-row" style="width:900px">
            <button class="push-route-endpoint push-route-scope" type="button">
              <span class="push-route-kind">Local branch</span>
              <span class="push-route-name"><strong>main</strong></span>
              <small>1 outgoing commit</small>
            </button>
            <span class="push-route-arrow"><small>Push</small><strong>→</strong></span>
            <div class="push-route-endpoint push-remote-target">
              <span class="push-route-kind">Remote branch</span>
              <span class="push-route-name push-route-destination">
                <svg width="14" height="14"></svg>
                <span class="select-control"><select id="push-remote-select"><option>origin</option></select><span class="select-control-chevron"></span></span>
                <span class="push-route-separator">/</span>
                <span class="push-branch-control" data-selected-value="main">
                  <span class="select-control"><select id="push-branch-select" title="main"><option>main</option></select><span class="select-control-chevron"></span></span>
                </span>
              </span>
              <small>Selected destination for this push</small>
            </div>
          </div>
          <div class="push-commit-list" id="push-paging-fixture" style="position:absolute;left:-9999px;width:240px;height:100px;overflow:auto">
            <div style="height:600px"></div><div class="push-commit-page-status idle" id="push-commit-page-status"></div>
          </div>
          <script>
            window.setBranch = (value) => {
              const wrapper = document.querySelector(".push-branch-control");
              const select = document.querySelector("#push-branch-select");
              wrapper.dataset.selectedValue = value;
              select.title = value;
              select.firstElementChild.textContent = value;
            };
          </script>
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
      const page = await browser.newPage({ viewport: { width: 1100, height: 400 } });
      await page.goto(`http://127.0.0.1:${address.port}/__push_route`);
      await page.waitForFunction(() => window.stylesReady);
      await page.evaluate(async () => {
        const { bindPushPreviewPagingSurface } = await import("/src/features/remote-push/push-preview-paging.ts");
        window.bindPushPreviewPagingSurface = bindPushPreviewPagingSurface;
        window.pushPagingState = {
          dialog: "push",
          pushPreview: { hasMore: true },
          pushPreviewLoadingMore: false,
          pushPreviewPagingError: null,
        };
        window.pushPagingLoads = 0;
        bindPushPreviewPagingSurface(
          document,
          window.pushPagingState,
          () => {
            window.pushPagingLoads += 1;
            window.pushPagingState.pushPreviewLoadingMore = true;
          },
          "Loading…",
        );
      });

      await page.locator("#push-paging-fixture").evaluate((host) => {
        host.scrollTop = host.scrollHeight;
      });
      await page.waitForFunction(() => window.pushPagingLoads === 1);
      assert.equal(
        await page.locator("#push-commit-page-status").textContent(),
        "Loading…",
        `${name}: auto paging exposes a loading state`,
      );
      await page.locator("#push-paging-fixture").evaluate((host) => {
        host.scrollTop = 0;
        host.scrollTop = host.scrollHeight;
        host.dispatchEvent(new Event("scroll"));
      });
      await page.waitForTimeout(50);
      assert.equal(await page.evaluate(() => window.pushPagingLoads), 1, `${name}: a pending page blocks duplicate scroll loads`);
      const restored = await page.evaluate(() => {
        const oldHost = document.querySelector("#push-paging-fixture");
        const before = oldHost.scrollTop;
        window.pushPagingState.pushPreviewLoadingMore = false;
        oldHost.outerHTML = `<div class="push-commit-list" id="push-paging-fixture" style="position:absolute;left:-9999px;width:240px;height:100px;overflow:auto"><div style="height:900px"></div><div class="push-commit-page-status idle" id="push-commit-page-status"></div></div>`;
        window.bindPushPreviewPagingSurface(
          document,
          window.pushPagingState,
          () => { window.pushPagingLoads += 1; },
          "Loading…",
        );
        return {
          before,
          after: document.querySelector("#push-paging-fixture").scrollTop,
        };
      });
      assert.ok(restored.before > 0, `${name}: the first page actually scrolled`);
      assert.equal(restored.after, restored.before, `${name}: appended-page rendering preserves scroll position`);

      const geometry = async () => page.evaluate(() => {
        const wrapper = document.querySelector(".push-branch-control");
        const destination = document.querySelector(".push-route-destination");
        const select = document.querySelector("#push-branch-select");
        const wrapperRect = wrapper.getBoundingClientRect();
        const destinationRect = destination.getBoundingClientRect();
        return {
          wrapperWidth: wrapperRect.width,
          wrapperRight: wrapperRect.right,
          destinationRight: destinationRect.right,
          textOverflow: getComputedStyle(select).textOverflow,
        };
      });

      const short = await geometry();
      assert.ok(short.wrapperWidth <= 90, `${name}: a short branch stays compact`);

      await page.evaluate(() => window.setBranch("dev-v8-launcher-module-rebuild"));
      const fitting = await geometry();
      assert.ok(fitting.wrapperWidth > 140, `${name}: a fitting branch grows past the former fixed cap`);
      assert.ok(fitting.wrapperRight <= fitting.destinationRight + 0.5, `${name}: fitting branch stays in its destination row`);

      await page.evaluate(() => window.setBranch(`feature/${"very-long-branch-segment-".repeat(20)}`));
      const overflowing = await geometry();
      assert.ok(overflowing.wrapperRight <= overflowing.destinationRight + 0.5, `${name}: an overflowing branch stays in its destination row`);
      assert.equal(overflowing.textOverflow, "ellipsis", `${name}: overflow uses an ellipsis`);
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}

console.log("Push route sizing and scroll paging passed in Chromium and WebKit.");
