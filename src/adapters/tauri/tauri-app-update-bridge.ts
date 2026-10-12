import type { AppUpdateCheckResult, AppUpdateInstallResult } from "../../models.ts";
import type { AppUpdateBridge } from "../../protocol/desktop-bridge.ts";
import { invokeDesktopCommand as invoke } from "./desktop-command-adapter.ts";

export const tauriAppUpdateBridge: AppUpdateBridge = {
  checkForAppUpdates: () => invoke<AppUpdateCheckResult>("check_for_app_updates"),
  installAppUpdate: () => invoke<AppUpdateInstallResult>("install_app_update"),
  openAppUpdateRelease: (releaseUrl) => invoke<void>("open_app_update_release", { releaseUrl }),
};
