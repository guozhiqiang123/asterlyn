import { getCurrentWindow } from "@tauri-apps/api/window";

const isNativeWindow = "__TAURI_INTERNALS__" in window;
const nativeWindow = isNativeWindow ? getCurrentWindow() : null;

export const windowControls = {
  available: isNativeWindow,

  minimize(): Promise<void> {
    return nativeWindow?.minimize() ?? Promise.resolve();
  },

  toggleMaximize(): Promise<void> {
    return nativeWindow?.toggleMaximize() ?? Promise.resolve();
  },

  close(): Promise<void> {
    return nativeWindow?.close() ?? Promise.resolve();
  },

  isMaximized(): Promise<boolean> {
    return nativeWindow?.isMaximized() ?? Promise.resolve(false);
  },

  onResized(handler: () => void): Promise<() => void> {
    return nativeWindow?.onResized(handler) ?? Promise.resolve(() => undefined);
  },
};
