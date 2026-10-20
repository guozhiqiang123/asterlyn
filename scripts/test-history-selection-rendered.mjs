import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: 0, hmr: false },
  plugins: [{
    name: "history-selection-fixture",
    configureServer(vite) {
      vite.middlewares.use("/__history_selection", (_request, response) => {
        response.setHeader("Content-Type", "text/html");
        response.end(`<!doctype html><html data-theme="light"><head><script type="module">
          import "/src/styles.css";
          window.stylesReady = true;
        </script></head><body><main id="history" class="history-results" style="width:900px;height:180px"></main></body></html>`);
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
      const page = await browser.newPage({ viewport: { width: 960, height: 260 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${address.port}/__history_selection`);
      await page.waitForFunction(() => window.stylesReady);
      await page.evaluate(async () => {
        const [{ GitHistoryListView }, { commitKey }] = await Promise.all([
          import("/src/features/git-history/history-list-view.ts"),
          import("/src/features/git-history/history-identity.ts"),
        ]);
        const commit = {
          repositoryId: ".",
          oid: "e625324006e625324006e625324006e625324006",
          shortOid: "e625324006",
          parents: [],
          decorations: [],
          authorName: "huweibin",
          authorEmail: "huweibin@example.test",
          authoredAt: 1_602_550_640,
          subject: "init project",
        };
        const view = new GitHistoryListView();
        const host = document.querySelector("#history");
        const key = commitKey(commit);
        view.mount(host, {
          selectCommit(selectedKey) { view.updateSelection(selectedKey); },
          expandLinearHistory() {},
          loadOlder() {},
          retryPaging() {},
          scroll() {},
        });
        view.render({
          status: "ready",
          error: null,
          loadedCommits: [commit],
          commits: [commit],
          textError: null,
          selectedCommit: key,
          collapseLinear: false,
          bridgeOmittedParents: false,
          repositoryRoots: [{ id: ".", relativePath: ".", displayName: "root", kind: "main" }],
          branches: [],
          loadingMore: false,
          pagingError: null,
          hasMore: false,
        });
        window.historySelectionFixture = { view };
      });

      const row = page.locator(".history-row");
      await row.click();
      await row.focus();
      const painted = await row.evaluate((element) => {
        const subject = element.querySelector(".history-subject");
        const bounds = subject.getBoundingClientRect();
        return {
          contentVisibility: getComputedStyle(element).contentVisibility,
          subject: subject.textContent,
          width: bounds.width,
          height: bounds.height,
          focused: element === document.activeElement,
        };
      });
      assert.equal(painted.contentVisibility, "visible", `${name}: focused history rows remain paintable`);
      assert.equal(painted.subject, "init project", `${name}: commit subject remains mounted`);
      assert.ok(painted.width > 0 && painted.height > 0, `${name}: commit subject keeps visible geometry`);
      assert.equal(painted.focused, true, `${name}: fixture exercises the focused row state`);
      assert.deepEqual(errors, [], `${name}: rendered fixture must not report page errors`);
      await page.evaluate(() => window.historySelectionFixture.view.unmount());
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
