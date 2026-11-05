import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  server: { host: "127.0.0.1", port: 0, hmr: false },
  plugins: [{
    name: "changes-folder-context-fixture",
    configureServer(vite) {
      vite.middlewares.use("/__changes_folders", (_request, response) => {
        response.setHeader("Content-Type", "text/html");
        response.end(`<!doctype html><html data-theme="dark"><head><script type="module">
          import "/src/styles.css";
          import "/src/shared/controls.css"; import "/src/shared/presentation.css";
          import "/src/shared/overlays.css"; import "/src/shared/context-menu/context-menu.css";
          import "/src/features/changes-commit/changes-commit.css";
          import "/src/features/files-editor/project-files.css";
          window.stylesReady = true;
        </script></head><body><main id="fixture" style="width:700px;height:680px;overflow:auto"></main>
        <div id="workspace-trash-operation-dialog" class="dialog-backdrop hidden"></div></body></html>`);
      });
    },
  }],
});

try {
  await server.listen();
  for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__changes_folders`);
      await page.waitForFunction(() => window.stylesReady);
      await page.evaluate(async () => {
        const [{ ContextMenuHost }, { ChangesContextSurfaceRuntime }, { changesContextTargetIsCurrent },
          { renderChangeNavigation }, { WorkspaceTrashRuntime }, { workspaceTrashPresentation }, { EN_US }] = await Promise.all([
          import("/src/shared/context-menu/context-menu-host.ts"),
          import("/src/features/changes-commit/changes-context-runtime.ts"),
          import("/src/features/changes-commit/changes-navigation-binding.ts"),
          import("/src/features/changes-commit/changes-view.ts"),
          import("/src/features/workspace-trash/workspace-trash-runtime.ts"),
          import("/src/features/workspace-trash/workspace-trash-presentation.ts"),
          import("/src/localization/en-US.ts"),
        ]);
        const change = (path, repositoryId = ".", worktreeStatus = "untracked") => ({
          repositoryId, path, workspacePath: repositoryId === "." ? path : `vendor/library/${path}`,
          originalPath: null, indexStatus: "unmodified", worktreeStatus, conflicted: false, submodule: false,
        });
        const snapshot = { root: "/repo", gitDir: "/repo/.git", untrackedState: "complete",
          repositoryRoots: [{ id: ".", relativePath: ".", displayName: "repo", kind: "main" },
            { id: "library", relativePath: "vendor/library", displayName: "library", kind: "submodule" }],
          branch: { head: "main", unborn: false }, operation: null,
          changes: [change(".openidea/.gitignore"), change(".openidea/changelists.json"),
            change("src/Feature.kt", ".", "modified"), change("src/Feature.kt", "library", "modified"),
            change(".openidea/new.txt", "library")],
        };
        const state = { fileView: "tree", excludedPaths: new Set(), collapsedDirectories: new Set(), selectedChange: null };
        const host = new ContextMenuHost(document, window);
        const fixture = window.folderFixture = { copies: [], plans: [], executions: 0, current: true, state, snapshot, host };
        const current = (target) => fixture.current && changesContextTargetIsCurrent(target, snapshot, 1, 1);
        const trash = new WorkspaceTrashRuntime({
          root: document.body,
          mutations: {
            plan(_identity, operation) {
              fixture.plans.push(operation);
              return { planId: "folder-plan", completion: Promise.resolve({ status: "ready", preview: {
                planId: "folder-plan", operation, entryCount: 4, totalBytes: 64, hiddenEntryCount: 2,
              } }) };
            },
            async execute() { fixture.executions += 1; return { status: "completed", outcome: { status: "completed" } }; },
            cancel() {},
          },
          runtime: { currentIdentity: () => ({ root: "/repo", generation: 1 }), isTargetCurrent: current,
            completed() {}, status() {}, error(error) { throw error; } },
          ...workspaceTrashPresentation(document.body, () => EN_US),
          changed() { fixture.render?.(); },
        });
        fixture.trash = trash;
        const root = document.querySelector("#fixture");
        fixture.render = () => { root.innerHTML = renderChangeNavigation(snapshot, state, 0, 680, EN_US.changes); };
        fixture.render();
        fixture.surface = new ChangesContextSurfaceRuntime({ root, host,
          clipboard: { async writeText(text) { fixture.copies.push(text); return { status: "copied" }; } },
          source: () => ({ snapshot, workspaceGeneration: 1, repositoryId: ".", repositoryRevision: 1, selectedPath: null }),
          copy: () => EN_US.changes,
          actions: { current, select() { throw new Error("Folder must not select a file"); },
            groupPolicy: () => ({ stage: { kind: "enabled" }, trash: { kind: "enabled" } }),
            trash: (target) => trash.controller.request(target), status() {}, blocked() {}, error(error) { throw error; } },
        });
      });
      const folder = page.locator('[data-change-directory=".openidea"][data-change-repository-id="."]');
      await folder.locator(".change-directory-row").click({ button: "right" });
      assert.equal(await page.getByRole("menuitem", { name: "Move to Trash…", exact: true }).count(), 1, `${name}: folder right-click opens Trash`);
      assert.equal(await page.getByRole("menuitem", { name: "Copy Path", exact: true }).count(), 1, `${name}: folder right-click opens Copy Path`);
      assert.equal(await folder.getAttribute("aria-expanded"), "true", `${name}: right-click does not collapse folder`);
      assert.deepEqual(await page.evaluate(() => window.folderFixture.plans), [], `${name}: opening menu does not plan a mutation`);
      await page.getByRole("menuitem", { name: "Copy Path", exact: true }).click();
      await page.getByRole("menuitem", { name: /^Absolute Path/u }).click();
      assert.deepEqual(await page.evaluate(() => window.folderFixture.copies), ["/repo/.openidea"]);

      await folder.focus();
      await page.keyboard.press("Shift+F10");
      await page.getByRole("menuitem", { name: "Move to Trash…", exact: true }).click();
      await page.getByRole("alertdialog").waitFor();
      assert.match(await page.getByRole("alertdialog").innerText(), /4 entries.*including 2 hidden entries/su, `${name}: folder review includes hidden contents`);
      assert.deepEqual(await page.evaluate(() => window.folderFixture.plans), [{ kind: "trash", source: ".openidea" }]);
      assert.equal(await page.evaluate(() => window.folderFixture.executions), 0, `${name}: no trash before confirmation`);
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("alertdialog").count(), 0);
      assert.equal(await folder.evaluate((element) => document.activeElement === element), true, `${name}: cancellation restores folder focus`);

      const child = page.locator('[data-change-directory=".openidea"][data-change-repository-id="library"]');
      await child.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Copy Path", exact: true }).click();
      await page.getByRole("menuitem", { name: /^Relative Path/u }).click();
      assert.equal(await page.evaluate(() => window.folderFixture.copies.at(-1)), "vendor/library/.openidea", `${name}: submodule paths are workspace-qualified`);
      await child.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Move to Trash…", exact: true }).click();
      await page.getByRole("alertdialog").waitFor();
      assert.equal(await page.evaluate(() => window.folderFixture.plans.at(-1).source), "vendor/library/.openidea");
      await page.locator("#workspace-trash-confirm").click();
      assert.equal(await page.evaluate(() => window.folderFixture.executions), 1, `${name}: confirmation executes the reviewed plan once`);

      await page.evaluate(() => {
        const fixture = window.folderFixture;
        fixture.state.collapsedDirectories.add("directory:.:unversioned:.openidea");
        fixture.render();
      });
      assert.equal(await folder.getAttribute("aria-expanded"), "false");
      await folder.click({ button: "right" });
      assert.equal(await page.getByRole("menuitem", { name: "Copy Path", exact: true }).count(), 1, `${name}: collapsed folders retain their context menu`);
      await page.keyboard.press("Escape");

      const trackedFolder = page.locator('[data-change-directory="src"][data-change-repository-id="."]');
      await trackedFolder.click({ button: "right" });
      assert.equal(await page.getByRole("menuitem", { name: "Move to Trash…", exact: true }).count(), 1, `${name}: tracked folders share the same menu`);
      await page.evaluate(() => { window.folderFixture.current = false; window.folderFixture.host.revalidate(); });
      assert.equal(await page.getByRole("menu").count(), 0, `${name}: stale folder menus close`);
      assert.deepEqual(errors, []);
      await page.evaluate(() => { const fixture = window.folderFixture; fixture.surface.dispose(); fixture.trash.dispose(); fixture.host.dispose(); });
      console.log(`PASS ${name}: Changes folder context, keyboard/copy, submodule identity, reviewed Trash and cancellation`);
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
