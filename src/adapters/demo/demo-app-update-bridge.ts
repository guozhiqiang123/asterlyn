import { BRAND } from "../../brand.ts";
import type { AppUpdateBridge } from "../../protocol/desktop-bridge.ts";

export const demoAppUpdateBridge: AppUpdateBridge = {
  async checkForAppUpdates() {
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    return {
      ok: true,
      currentVersion: BRAND.version,
      latestVersion: BRAND.version,
      hasUpdate: false,
      releaseUrl: BRAND.releaseUrl,
      checkedAtEpochMs: Date.now(),
      assetName: null,
      assetSizeBytes: null,
      canInstall: false,
      error: null,
    };
  },
  async installAppUpdate() {
    return { ok: false, message: "Updates are unavailable in the browser demo.", error: "Desktop application required." };
  },
  async openAppUpdateRelease(releaseUrl) {
    window.open(releaseUrl, "_blank", "noopener,noreferrer");
  },
};
