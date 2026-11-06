import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";

const server = await createServer({
  root: process.cwd(),
  server: { host: "127.0.0.1", port: 0, hmr: false },
  plugins: [{
    name: "managed-language-status-fixture",
    configureServer(vite) {
      vite.middlewares.use("/__managed-language-status", (_request, response) => {
        response.setHeader("Content-Type", "text/html");
        response.end(`<!doctype html><html data-theme="dark"><body><main><label>Editor<input id="editor"></label></main><footer class="statusbar"><div class="status-right"><div id="managed-language-status-host"></div></div></footer><script type="module" src="/scripts/fixtures/managed-language-status-fixture.ts"></script></body></html>`);
      });
    },
  }],
});

await server.listen();
try {
  const port = server.httpServer.address().port;
  for (const [name, engine] of [["Chromium", chromium], ["WebKit", webkit]]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${port}/__managed-language-status`, { waitUntil: "networkidle" });
      const host = page.locator("#managed-language-status-host");
      await page.waitForSelector('[data-managed-language-state="unconfigured"]');
      assert.match(await host.innerText(), /Rust language service is not configured/u);
      assert.equal(await host.getByRole("button", { name: "Manage" }).count(), 1);
      assert.equal(await host.getByRole("button", { name: "Don't show for this project" }).count(), 1);
      assert.equal(await host.getByRole("button", { name: "Later" }).count(), 1);

      await host.getByRole("button", { name: "Manage" }).focus();
      await page.keyboard.press("Enter");
      assert.deepEqual((await page.evaluate(() => window.managedLanguageStatusFixture.snapshot())).opened, ["dev.asterlyn.lsp"]);

      await page.evaluate(() => window.managedLanguageStatusFixture.setSource("read-only-source"));
      assert.equal(await host.innerHTML(), "", `${name}: read-only source must not recommend installation`);
      await page.evaluate(() => window.managedLanguageStatusFixture.setSource("editable-source"));
      await page.waitForSelector('[data-managed-language-state="unconfigured"]');

      await host.getByRole("button", { name: "Later" }).click();
      assert.equal(await host.innerHTML(), "");
      assert.equal((await page.evaluate(() => window.managedLanguageStatusFixture.snapshot())).activeElement, "editor");
      await page.evaluate(() => window.managedLanguageStatusFixture.setSource("editable-source", "/repo-b"));
      await page.waitForSelector('[data-managed-language-state="unconfigured"]');

      await host.getByRole("button", { name: "Don't show for this project" }).click();
      assert.equal(await host.innerHTML(), "");
      let snapshot = await page.evaluate(() => window.managedLanguageStatusFixture.snapshot());
      assert.equal(snapshot.suppressed, 1);
      assert.equal(snapshot.activeElement, "editor");
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector('[data-managed-language-state="unconfigured"]');
      await page.evaluate(() => window.managedLanguageStatusFixture.setSource("editable-source", "/repo-b"));
      assert.equal(await page.locator("#managed-language-status-host").innerHTML(), "", `${name}: persisted project suppression must survive reload`);
      await page.evaluate(() => window.managedLanguageStatusFixture.resetRecommendations("/repo-b"));
      await page.waitForSelector('[data-managed-language-state="unconfigured"]');

      await page.evaluate(() => window.managedLanguageStatusFixture.setEnabled(false));
      assert.equal(await page.locator("#managed-language-status-host").innerHTML(), "", `${name}: disabled plugin must not leave a stale recommendation`);
      await page.evaluate(() => window.managedLanguageStatusFixture.setEnabled(true));
      await page.waitForSelector('[data-managed-language-state="unconfigured"]');
      const bounds = await page.locator(".managed-language-status").boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 1280);
      await page.evaluate(() => window.managedLanguageStatusFixture.dispose());
      assert.equal(await page.locator("#managed-language-status-host").innerHTML(), "");
      assert.deepEqual(errors, []);
      console.log(`${name}: managed recommendation visibility, keyboard actions, suppression, recovery and focus passed`);
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
