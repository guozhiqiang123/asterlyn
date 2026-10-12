import assert from "node:assert/strict";
import test from "node:test";

import { AppUpdateController } from "../src/features/settings/app-update-controller.ts";

const releaseUrl = "https://github.com/guozhiqiang123/asterlyn/releases/latest";

function availableResult() {
  return {
    ok: true,
    currentVersion: "0.1.4",
    latestVersion: "0.2.0",
    hasUpdate: true,
    releaseUrl: releaseUrl.replace("latest", "tag/v0.2.0"),
    checkedAtEpochMs: 1_700_000_000_000,
    assetName: "Asterlyn_0.2.0_aarch64.dmg",
    assetSizeBytes: 9_000_000,
    canInstall: true,
    error: null,
  };
}

function gateway(overrides = {}) {
  return {
    checkForAppUpdates: async () => availableResult(),
    installAppUpdate: async () => ({ ok: true, message: "Installer ready", error: null }),
    openAppUpdateRelease: async () => {},
    ...overrides,
  };
}

test("startup update check prompts only for an installable newer Release", async () => {
  const controller = new AppUpdateController(gateway(), "0.1.4", releaseUrl);
  let changes = 0;
  controller.subscribe(() => { changes += 1; });

  const pending = controller.check(true);
  assert.equal(controller.state.status, "checking");
  await pending;
  assert.equal(controller.state.status, "available");
  assert.equal(controller.state.latestVersion, "0.2.0");
  assert.equal(controller.state.assetName, "Asterlyn_0.2.0_aarch64.dmg");
  assert.equal(controller.state.dialog, "confirm");
  assert.ok(changes >= 2);
});

test("manual update check leaves the result in Settings without forcing a dialog", async () => {
  const controller = new AppUpdateController(gateway(), "0.1.4", releaseUrl);
  await controller.check();
  assert.equal(controller.state.status, "available");
  assert.equal(controller.state.dialog, null);
  controller.requestInstall();
  assert.equal(controller.state.dialog, "confirm");
  controller.closeDialog();
  assert.equal(controller.state.dialog, null);
});

test("confirmed installation suppresses duplicate work and retains the exit message", async () => {
  let installs = 0;
  let finishInstall;
  const install = new Promise((resolve) => { finishInstall = resolve; });
  const controller = new AppUpdateController(gateway({
    installAppUpdate: async () => {
      installs += 1;
      return install;
    },
  }), "0.1.4", releaseUrl);
  await controller.check();
  controller.requestInstall();
  const first = controller.install();
  const second = controller.install();
  assert.equal(controller.state.status, "installing");
  assert.equal(controller.state.dialog, "installing");
  assert.equal(installs, 1);
  finishInstall({ ok: true, message: "Asterlyn will restart", error: null });
  await Promise.all([first, second]);
  assert.equal(controller.state.installMessage, "Asterlyn will restart");
});

test("installation failure stays actionable and preserves the Release fallback", async () => {
  const controller = new AppUpdateController(gateway({
    installAppUpdate: async () => ({ ok: false, message: "Failed", error: "Digest mismatch" }),
  }), "0.1.4", releaseUrl);
  await controller.check();
  await controller.install();
  assert.equal(controller.state.status, "error");
  assert.equal(controller.state.dialog, "error");
  assert.equal(controller.state.error, "Digest mismatch");
  controller.closeDialog();
  assert.equal(controller.state.status, "available");
});

test("check and Release-page failures remain visible", async () => {
  const controller = new AppUpdateController(gateway({
    checkForAppUpdates: async () => ({
      ok: false,
      currentVersion: "0.1.4",
      latestVersion: null,
      hasUpdate: false,
      releaseUrl,
      checkedAtEpochMs: 1_700_000_000_000,
      assetName: null,
      assetSizeBytes: null,
      canInstall: false,
      error: "No published Release",
    }),
    openAppUpdateRelease: async () => { throw new Error("Browser unavailable"); },
  }), "0.1.4", releaseUrl);

  await controller.check();
  assert.equal(controller.state.status, "error");
  assert.equal(controller.state.error, "No published Release");
  await controller.openRelease();
  assert.equal(controller.state.openingRelease, false);
  assert.equal(controller.state.error, "Browser unavailable");
});
