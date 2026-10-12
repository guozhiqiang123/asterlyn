import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { EN_US } from "../src/localization/en-US.ts";
import { renderAppUpdateDialog } from "../src/features/settings/settings-view.ts";

const available = {
  status: "available",
  currentVersion: "0.1.4",
  latestVersion: "0.2.0",
  releaseUrl: "https://github.com/guozhiqiang123/asterlyn/releases/tag/v0.2.0",
  checkedAtEpochMs: 1_700_000_000_000,
  assetName: "Asterlyn_0.2.0_aarch64.dmg",
  assetSizeBytes: 9_437_184,
  canInstall: true,
  error: null,
  openingRelease: false,
  dialog: "confirm",
  installMessage: null,
};

test("update confirmation names the exact package and requires an explicit action", () => {
  const markup = renderAppUpdateDialog(available, EN_US.settings, EN_US.common);
  assert.match(markup, /role="dialog" aria-modal="true"/u);
  assert.match(markup, /Asterlyn_0\.2\.0_aarch64\.dmg/u);
  assert.match(markup, /9\.0 MB/u);
  assert.match(markup, /id="app-update-confirm"/u);
  assert.match(markup, /unsigned and macOS packages are ad-hoc signed/u);
});

test("installing update dialog cannot be dismissed while the native operation is active", () => {
  const markup = renderAppUpdateDialog({
    ...available,
    status: "installing",
    dialog: "installing",
  }, EN_US.settings, EN_US.common);
  assert.match(markup, /app-update-spinner/u);
  assert.doesNotMatch(markup, /app-update-confirm|app-update-cancel|app-update-dialog-close/u);
});

test("application startup triggers the same update controller without blocking project open", async () => {
  const source = await readFile(new URL("../src/app.ts", import.meta.url), "utf8");
  const check = source.indexOf("this.appUpdatePresentationRuntime.checkOnStartup()");
  const repository = source.indexOf("const initial = await bridge.initialRepository()", check);
  assert.ok(check >= 0, "startup should begin an update check");
  assert.ok(repository > check, "the update check should not be awaited before project startup");
});
