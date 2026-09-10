export type WindowChromeMode = "macos-native" | "custom-right";

export function parseWindowChromeMode(value: unknown): WindowChromeMode {
  return value === "macos-native" ? value : "custom-right";
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
