export type TextClipboardResult =
  | { readonly status: "copied" }
  | {
      readonly status: "failure";
      readonly reason: "unavailable" | "write-failed";
      readonly error?: unknown;
    };

/** Product-facing text-only clipboard boundary. It owns no selection or repository state. */
export interface TextClipboardPort {
  writeText(text: string): Promise<TextClipboardResult>;
}

export async function writeClipboardText(
  clipboard: Pick<Clipboard, "writeText">,
  text: string,
): Promise<TextClipboardResult> {
  try {
    await clipboard.writeText(text);
    return { status: "copied" };
  } catch (error) {
    return { status: "failure", reason: "write-failed", error };
  }
}
