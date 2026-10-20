import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: 0, hmr: false },
  plugins: [{
    name: "git-blame-fixture",
    configureServer(vite) {
      vite.middlewares.use("/__git_blame", (_request, response) => {
        response.setHeader("Content-Type", "text/html");
        response.end(`<!doctype html><html data-theme="dark"><head><script type="module">
          import "/src/styles.css";
          import "/src/main.ts";
          window.stylesReady = true;
        </script></head><body><main id="editor" class="content-body" style="width:1000px;height:620px"></main><button id="outside" style="position:fixed;right:0;bottom:0;z-index:100">Outside</button></body></html>`);
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
      await page.goto(`http://127.0.0.1:${address.port}/__git_blame`);
      await page.waitForFunction(() => window.stylesReady);
      await page.evaluate(async () => {
        const [{ TextEditor }, { DEFAULT_APP_PREFERENCES }, { EN_US }] = await Promise.all([
          import("/src/text-editor.ts"),
          import("/src/preferences.ts"),
          import("/src/localization/en-US.ts"),
        ]);
        const source = {
          repositoryRoot: "/repo",
          repositoryId: "vendor/library",
          path: "src/Feature.kt",
          commitOid: null,
          parent: false,
        };
        const oid = "0123456789abcdef0123456789abcdef01234567";
        const hunk = {
          oid,
          originalStartLine: 1,
          finalStartLine: 1,
          lineCount: 1,
          authorName: "Grace Hopper",
          authorEmail: "grace@example.test",
          authoredAt: Math.floor(new Date(2026, 8, 8, 12).getTime() / 1000),
          summary: "Implement feature",
          uncommitted: false,
        };
        const secondHunk = {
          ...hunk,
          oid: "89abcdef0123456789abcdef0123456789abcdef",
          originalStartLine: 2,
          finalStartLine: 2,
          authorName: "Ada",
          authorEmail: "ada@example.test",
          authoredAt: Math.floor(new Date(2024, 0, 2, 3, 4).getTime() / 1000),
          summary: "Refine feature",
        };
        const menu = {
          session: null,
          opens: 0,
          open(_anchor, session) { this.opens += 1; this.session = session; },
          close() { this.session = null; },
          revalidate() {},
        };
        window.gitBlameFixture = { menu, opened: null, loads: 0 };
        const runtime = {
          async load() {
            window.gitBlameFixture.loads += 1;
            return { repositoryId: source.repositoryId, path: source.path, revision: null, hunks: [hunk, secondHunk], truncated: false };
          },
          openCommit(openedSource, openedHunk) { window.gitBlameFixture.opened = { source: openedSource, hunk: openedHunk }; },
          status() {},
          error(error) { throw error; },
        };
        const editor = new TextEditor(runtime, EN_US.editor, menu);
        editor.mount(document.querySelector("#editor"), "fixture", 1, "first\nsecond\n", "first\nsecond\n", source.path, DEFAULT_APP_PREFERENCES, source, null, () => {});
        window.gitBlameFixture.editor = editor;
      });

      assert.equal(await page.locator(".cm-git-blame-gutter").count(), 0, `${name}: blame must start hidden`);
      const foldGutter = await page.locator(".cm-foldGutter").boundingBox();
      assert.ok(foldGutter, `${name}: fold gutter exists beside line numbers`);
      await page.mouse.click(
        foldGutter.x + foldGutter.width / 2,
        Math.min(foldGutter.y + foldGutter.height - 4, foldGutter.y + 140),
        { button: "right" },
      );
      await page.waitForFunction(() => window.gitBlameFixture.menu.session !== null);
      assert.equal(await page.evaluate(() => window.gitBlameFixture.menu.opens), 1, `${name}: blank fold-gutter area opens one menu`);
      await page.evaluate(async () => {
        const session = window.gitBlameFixture.menu.session;
        await session.invoke("editor.git-blame.toggle");
        session.restoreFocus();
      });
      await page.waitForSelector(".cm-git-blame-gutter .cm-git-blame-marker");
      await page.waitForSelector(".cm-git-blame-line-end");
      const rendered = await page.locator(".cm-git-blame-gutter .cm-git-blame-marker").first().innerText();
      assert.match(rendered, /Grace Hopper/u, `${name}: author is rendered`);
      assert.match(rendered, /2026-09-08/u, `${name}: date is rendered`);
      assert.doesNotMatch(rendered, /12:00/u, `${name}: time is omitted`);
      assert.equal(await page.locator(".cm-git-blame-line-end").count(), 1, `${name}: line-end annotation remains`);
      assert.match(
        await page.locator(".cm-git-blame-line-end").innerText(),
        /Grace Hopper · 2026-09-08 12:00/u,
        `${name}: line-end annotation keeps the exact authored time`,
      );
      const markerLayout = await page.locator(".cm-git-blame-gutter .cm-git-blame-marker").evaluateAll((markers) => {
        return markers.slice(0, 2).map((marker) => {
          const author = marker.querySelector(".cm-git-blame-author").getBoundingClientRect();
          const date = marker.querySelector(".cm-git-blame-time").getBoundingClientRect();
          return { authorLeft: Math.round(author.left), dateLeft: Math.round(date.left), gap: Math.round(author.left - date.right) };
        });
      });
      assert.equal(markerLayout.length, 2, `${name}: two independent blame rows are rendered`);
      assert.ok(markerLayout.every((row) => row.gap >= 6 && row.gap <= 10), `${name}: date/author gap is compact`);
      assert.equal(markerLayout[0].dateLeft, markerLayout[1].dateLeft, `${name}: dates share one column`);
      assert.equal(markerLayout[0].authorLeft, markerLayout[1].authorLeft, `${name}: authors share one aligned column`);
      await page.locator(".cm-line").nth(1).click();
      await page.waitForFunction(() => document.querySelector(".cm-git-blame-line-end")?.textContent?.includes("Ada · 2024-01-02 03:04"));
      await page.locator("#outside").click();
      await page.waitForTimeout(100);
      assert.equal(
        await page.locator(".cm-git-blame-line-end").count(),
        1,
        `${name}: selected-line annotation survives editor focus transfer`,
      );
      await page.locator(".cm-git-blame-line-end").click();
      assert.equal(
        await page.evaluate(() => window.gitBlameFixture.opened?.hunk.oid),
        "89abcdef0123456789abcdef0123456789abcdef",
        `${name}: line-end annotation opens its commit`,
      );
      await page.evaluate(() => { window.gitBlameFixture.opened = null; });
      await page.locator(".cm-git-blame-gutter .cm-git-blame-marker").first().click();
      const opened = await page.evaluate(() => window.gitBlameFixture.opened);
      assert.equal(opened.source.repositoryId, "vendor/library", `${name}: repository identity is preserved`);
      assert.equal(opened.hunk.oid, "0123456789abcdef0123456789abcdef01234567", `${name}: commit identity is preserved`);
      assert.equal(await page.evaluate(() => window.gitBlameFixture.loads), 1, `${name}: one explicit load`);
      assert.deepEqual(errors, [], `${name}: rendered fixture must not report page errors`);
      await page.evaluate(() => window.gitBlameFixture.editor.destroy());
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
