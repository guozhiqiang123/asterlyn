import type { DesktopShellBridge } from "../../protocol/desktop-bridge.ts";

/** Browser-only shell presentation and explicit text clipboard access. */
export const demoShellBridge: Pick<DesktopShellBridge, "windowChromeMode" | "readTextClipboard" | "writeTextClipboard"> = {
  windowChromeMode: async () => "custom-right",
  readTextClipboard: () => navigator.clipboard.readText(),
  writeTextClipboard: text => navigator.clipboard.writeText(text),
};
