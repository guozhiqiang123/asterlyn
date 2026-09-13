import { isTauriRuntime } from "./desktop-command-adapter.ts";
import type { NativeAppearancePort } from "../../presentation/presentation-environment.ts";

export const nativeAppearance: NativeAppearancePort = {
  async setTheme(theme) {
    if (!isTauriRuntime) return;
    const { setTheme } = await import("@tauri-apps/api/app");
    await setTheme(theme === "system" ? null : theme);
  },
};
