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
          async load(requestedSource) {
            window.gitBlameFixture.loads += 1;
            const result = {
              repositoryId: requestedSource.repositoryId, path: requestedSource.path,
              revision: requestedSource.commitOid, hunks: [hunk, secondHunk], truncated: false,
            };
            if (requestedSource.path === "src/Delayed.kt") {
              return new Promise((resolve) => {
                window.gitBlameFixture.resolveDelayed = () => resolve(result);
              });
            }
            if (requestedSource.path === "src/Failed.kt") throw new Error("Fixture blame unavailable");
            if (requestedSource.path === "src/New.kt") result.hunks = [{ ...hunk, authorName: "New Author", lineCount: 2 }];
            return result;
          },
          openCommit(openedSource, openedHunk) { window.gitBlameFixture.opened = { source: openedSource, hunk: openedHunk }; },
          status() {},
          error(error) { throw error; },
        };
        const editor = new TextEditor(runtime, EN_US.editor, menu);
        window.gitBlameFixture.editor = editor;
        window.gitBlameFixture.mountText = (id = "fixture", path = source.path, epoch = 1, tracked = true) => {
          editor.mount(document.querySelector("#editor"), id, epoch, "first\nsecond\n", "first\nsecond\n", path, DEFAULT_APP_PREFERENCES,
            tracked ? { ...source, path } : null, tracked ? null : "Untracked fixture", () => {});
        };
        window.gitBlameFixture.runtime = runtime;
        window.gitBlameFixture.source = source;
        window.gitBlameFixture.mountText();
      });

      assert.equal(await page.locator(".cm-git-blame-gutter").count(), 0, `${name}: blame must start hidden`);
      assert.equal(await page.evaluate(() => window.gitBlameFixture.loads), 0, `${name}: mounting an unfocused editor does not load authorship`);
      await page.locator(".cm-line").first().click();
      await page.waitForSelector(".cm-git-blame-line-end");
      assert.match(await page.locator(".cm-git-blame-line-end").innerText(), /Grace Hopper/u, `${name}: focusing a line loads authorship without the gutter`);
      assert.equal(await page.locator(".cm-git-blame-gutter").count(), 0, `${name}: automatic authorship keeps the gutter hidden`);
      const foldGutter = await page.locator(".cm-foldGutter").boundingBox();
      assert.ok(foldGutter, `${name}: fold gutter exists beside line numbers`);
      await page.mouse.click(
        foldGutter.x + foldGutter.width / 2,
        Math.min(foldGutter.y + foldGutter.height - 4, foldGutter.y + 140),
        { button: "right" },
      );
      await page.waitForFunction(() => window.gitBlameFixture.menu.session !== null);
      assert.equal(await page.evaluate(() => window.gitBlameFixture.menu.session.model.items[0].checked), false, `${name}: inline metadata does not check the gutter action`);
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
      await page.locator(".cm-lineNumbers").click({ button: "right" });
      await page.evaluate(async () => {
        const session = window.gitBlameFixture.menu.session;
        await session.invoke("editor.git-blame.toggle");
        session.restoreFocus();
      });
      assert.equal(await page.locator(".cm-git-blame-gutter").count(), 0, `${name}: hiding the gutter only removes its own column`);
      assert.equal(await page.locator(".cm-git-blame-line-end").count(), 1, `${name}: inline authorship survives hiding the gutter`);
      await page.locator(".cm-line").first().click();
      await page.waitForFunction(() => document.querySelector(".cm-git-blame-line-end")?.textContent?.includes("Grace Hopper"));
      assert.equal(await page.evaluate(() => window.gitBlameFixture.loads), 1, `${name}: cursor changes and gutter toggles reuse one load`);
      assert.equal(await page.evaluate(() => window.gitBlameFixture.editor.content()), "first\nsecond\n", `${name}: authorship widgets do not alter source content`);
      await page.evaluate(() => window.gitBlameFixture.mountText("other", "src/New.kt"));
      await page.locator(".cm-line").first().click();
      await page.waitForFunction(() => document.querySelector(".cm-git-blame-line-end")?.textContent?.includes("New Author"));
      await page.evaluate(() => window.gitBlameFixture.mountText());
      await page.waitForFunction(() => document.querySelector(".cm-git-blame-line-end")?.textContent?.includes("Grace Hopper"));
      assert.equal(await page.evaluate(() => window.gitBlameFixture.loads), 2, `${name}: switching back to a cached tab reuses its own author data`);
      await page.locator(".cm-content").press("End");
      await page.keyboard.type(" dirty");
      assert.equal(await page.locator(".cm-git-blame-line-end").count(), 0, `${name}: edits immediately remove saved-source metadata`);
      await page.evaluate(() => window.gitBlameFixture.mountText("fixture", "src/Feature.kt", 2));
      await page.waitForSelector(".cm-git-blame-line-end");
      assert.equal(await page.evaluate(() => window.gitBlameFixture.loads), 3, `${name}: saved-source replacement reloads authorship once`);

      await page.evaluate(() => window.gitBlameFixture.mountText("delayed", "src/Delayed.kt"));
      await page.locator(".cm-line").first().click();
      await page.waitForFunction(() => window.gitBlameFixture.resolveDelayed !== undefined);
      await page.keyboard.type(" edited before completion");
      await page.evaluate(() => window.gitBlameFixture.resolveDelayed());
      await page.waitForTimeout(100);
      assert.equal(await page.locator(".cm-git-blame-line-end").count(), 0, `${name}: a delayed response cannot annotate a dirty document`);

      await page.evaluate(() => window.gitBlameFixture.mountText("failed", "src/Failed.kt"));
      await page.locator(".cm-line").first().click();
      await page.waitForFunction(() => window.gitBlameFixture.loads === 5);
      await page.locator(".cm-line").nth(1).click();
      await page.locator("#outside").click();
      await page.locator(".cm-line").first().click();
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => window.gitBlameFixture.loads), 5, `${name}: failed automatic queries are not retried for each cursor or focus change`);
      await page.evaluate(() => window.gitBlameFixture.mountText("untracked", "src/Untracked.kt", 1, false));
      await page.locator(".cm-line").first().click();
      assert.equal(await page.locator(".cm-git-blame-line-end").count(), 0, `${name}: untracked files have no invented authorship`);
      assert.equal(await page.evaluate(() => window.gitBlameFixture.loads), 5, `${name}: untracked files do not request Git Blame`);
      for (const kind of ["readonly", "editable", "conflict"]) {
        await page.evaluate(async (kind) => {
          const [{ DiffEditor }, { EditableDiffEditor }, { ConflictEditor }, { DEFAULT_APP_PREFERENCES }, { EN_US }] = await Promise.all([
            import("/src/diff-editor.ts"), import("/src/editable-diff-editor.ts"), import("/src/conflict-editor.ts"),
            import("/src/preferences.ts"), import("/src/localization/en-US.ts"),
          ]);
          const fixture = window.gitBlameFixture;
          fixture.editor.destroy();
          const host = document.querySelector("#editor");
          host.replaceChildren();
          const source = fixture.source;
          const before = { source: { ...source, commitOid: "0123456789abcdef0123456789abcdef01234567" }, unavailableReason: null };
          const after = { source, unavailableReason: null };
          const sources = { old: before, new: after, unifiedReason: "Exact source requires split" };
          const presentation = { layout: "split", showWhitespace: false };
          const labels = { before: "Before", after: "After" };
          let editor;
          if (kind === "readonly") {
            host.className = "content-body diff-surface";
            editor = new DiffEditor(fixture.runtime, EN_US.editor, fixture.menu);
            editor.mount(host, "diff --git a/Feature.kt b/Feature.kt\n--- a/Feature.kt\n+++ b/Feature.kt\n@@ -1,2 +1,2 @@\n-first\n+updated\n second\n", source.path, DEFAULT_APP_PREFERENCES, presentation, labels, sources, () => {});
          } else if (kind === "editable") {
            host.className = "content-body diff-surface editable-diff-surface";
            editor = new EditableDiffEditor(EN_US.editor, fixture.runtime, fixture.menu);
            editor.mount(host, "first\nsecond\n", "updated\nsecond\n", source.path, DEFAULT_APP_PREFERENCES, presentation, labels, sources, true, () => {});
          } else {
            host.className = "content-body conflict-editor-surface";
            editor = new ConflictEditor(fixture.runtime, EN_US.editor, fixture.menu);
            editor.mount(host, {
              path: source.path, base: "base\nsecond\n", ours: "first\nsecond\n", theirs: "updated\nsecond\n",
              worktree: null, binary: false, revisionToken: "blame-fixture",
            }, "first\nsecond\n", DEFAULT_APP_PREFERENCES, presentation, EN_US.gitOperations, EN_US.editor,
            { ours: before, theirs: before, unifiedReason: sources.unifiedReason }, () => {});
            editor.setUnchangedExpanded(true);
          }
          fixture.editor = editor;
          fixture.menu.session = null;
        }, kind);
        const panes = page.locator("#editor .cm-editor:visible");
        for (const index of [0, (await panes.count()) - 1]) {
          const pane = panes.nth(index);
          await pane.locator(".cm-line").first().click();
          await pane.locator(".cm-git-blame-line-end").waitFor();
          assert.equal(await pane.locator(".cm-git-blame-gutter").count(), 0, `${name}: ${kind} pane ${index} shows authorship with its gutter hidden`);
        }
        const pane = panes.last();
        const loaded = await page.evaluate(() => window.gitBlameFixture.loads);
        for (const enabled of [true, false]) {
          await pane.locator(".cm-gutters").first().click({ button: "right" });
          await page.evaluate(async () => {
            const session = window.gitBlameFixture.menu.session;
            await session.invoke("editor.git-blame.toggle");
            session.restoreFocus();
          });
          assert.equal(await pane.locator(".cm-git-blame-gutter").count(), enabled ? 1 : 0, `${name}: ${kind} gutter toggles independently`);
          assert.equal(await pane.locator(".cm-git-blame-line-end").count(), 1, `${name}: ${kind} keeps current-line authorship`);
        }
        assert.equal(await page.evaluate(() => window.gitBlameFixture.loads), loaded, `${name}: ${kind} gutter toggles reuse cached authorship`);
        await page.evaluate(() => window.gitBlameFixture.editor.setPresentation({ layout: "unified", showWhitespace: false }));
        await page.locator("#editor .cm-line:visible").first().click();
        assert.equal(await page.locator(".cm-git-blame-line-end").count(), 0, `${name}: ${kind} unified mode does not invent source authorship`);
        assert.equal(await page.evaluate(() => window.gitBlameFixture.loads), loaded, `${name}: ${kind} unified mode does not load ambiguous authorship`);
      }
      assert.deepEqual(errors, [], `${name}: rendered fixture must not report page errors`);
      await page.evaluate(() => window.gitBlameFixture.editor.destroy());
      console.log(`PASS ${name}: independent inline/gutter authorship, cached tabs, invalidation, and split editor panes`);
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
