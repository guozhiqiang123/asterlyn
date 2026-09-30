import type { WindowChromeMode } from "../protocol/window-chrome.ts";

export { parseWindowChromeMode } from "../protocol/window-chrome.ts";
export type { WindowChromeMode } from "../protocol/window-chrome.ts";

export function windowChromeClass(mode: WindowChromeMode): string {
  return mode === "macos-native"
    ? "platform-macos-native"
    : "platform-custom-chrome";
}

export function showCustomWindowControls(
  mode: WindowChromeMode,
  nativeWindowAvailable: boolean,
): boolean {
  return nativeWindowAvailable && mode === "custom-right";
}
