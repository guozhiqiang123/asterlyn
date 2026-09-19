export type WindowChromeMode = "macos-native" | "custom-right";

export function parseWindowChromeMode(value: unknown): WindowChromeMode {
  return value === "macos-native" ? value : "custom-right";
}
