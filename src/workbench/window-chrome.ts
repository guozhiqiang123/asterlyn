import type { WindowChromeMode } from "../protocol/window-chrome.ts";

export { parseWindowChromeMode } from "../protocol/window-chrome.ts";
export type { WindowChromeMode } from "../protocol/window-chrome.ts";

export interface PrimaryShortcut {
  label: string;
  accessible: string;
}

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

export function primaryShortcut(
  mode: WindowChromeMode,
  key: string,
  shift = false,
): PrimaryShortcut {
  const normalizedKey = key.length === 1 ? key.toUpperCase() : key;
  if (mode === "macos-native") {
    return {
      label: `⌘${shift ? "⇧" : ""}${normalizedKey}`,
      accessible: `Command+${shift ? "Shift+" : ""}${normalizedKey}`,
    };
  }
  const label = `Ctrl+${shift ? "Shift+" : ""}${normalizedKey}`;
  return { label, accessible: label };
}
