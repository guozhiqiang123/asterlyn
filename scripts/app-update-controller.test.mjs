import assert from "node:assert/strict";
import test from "node:test";

import { AppUpdateController } from "../src/features/settings/app-update-controller.ts";

const releaseUrl = "https://github.com/guozhiqiang123/asterlyn/releases/latest";

test("app update controller exposes an available GitHub Release", async () => {
  const controller = new AppUpdateController({
    checkForAppUpdates: async () => ({
      ok: true,
      currentVersion: "0.1.0",
      latestVersion: "v0.2.0",
      hasUpdate: true,
      releaseUrl: releaseUrl.replace("latest", "tag/v0.2.0"),
      checkedAtEpochMs: 1_700_000_000_000,
      error: null,
    }),
    openAppUpdateRelease: async () => {},
  }, "0.1.0", releaseUrl);

  const pending = controller.check();
  assert.equal(controller.state.status, "checking");
  await pending;
  assert.equal(controller.state.status, "available");
  assert.equal(controller.state.latestVersion, "v0.2.0");
});

test("app update controller retains a visible failure and release fallback", async () => {
  const controller = new AppUpdateController({
    checkForAppUpdates: async () => ({
      ok: false,
      currentVersion: "0.1.0",
      latestVersion: null,
      hasUpdate: false,
      releaseUrl,
      checkedAtEpochMs: 1_700_000_000_000,
      error: "No published Release",
    }),
    openAppUpdateRelease: async () => { throw new Error("Browser unavailable"); },
  }, "0.1.0", releaseUrl);

  await controller.check();
  assert.equal(controller.state.status, "error");
  assert.equal(controller.state.error, "No published Release");
  await controller.openRelease();
  assert.equal(controller.state.openingRelease, false);
  assert.equal(controller.state.error, "Browser unavailable");
});
