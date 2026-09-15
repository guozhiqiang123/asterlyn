import {
  writeClipboardText,
  type TextClipboardPort,
} from "../../application/text-clipboard.ts";

/** Uses the secure WebView clipboard exposed by the current native window. */
export function createBrowserTextClipboardAdapter(
  navigator: { readonly clipboard?: Pick<Clipboard, "writeText"> },
): TextClipboardPort {
  return {
    writeText: (text) => navigator.clipboard
      ? writeClipboardText(navigator.clipboard, text)
      : Promise.resolve({ status: "failure", reason: "unavailable" }),
  };
}
