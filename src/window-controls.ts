import { getCurrentWindow } from "@tauri-apps/api/window";

interface NativeWindowPort {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  destroy(): Promise<void>;
  isMaximized(): Promise<boolean>;
  onResized(handler: () => void): Promise<() => void>;
  onCloseRequested(
    handler: (event: { preventDefault(): void }) => void | Promise<void>,
  ): Promise<() => void>;
}

export function createWindowControls(nativeWindow: NativeWindowPort | null) {
  return {
    available: nativeWindow !== null,

    minimize(): Promise<void> {
      return nativeWindow?.minimize() ?? Promise.resolve();
    },

    toggleMaximize(): Promise<void> {
      return nativeWindow?.toggleMaximize() ?? Promise.resolve();
    },

    close(): Promise<void> {
      return nativeWindow?.destroy() ?? Promise.resolve();
    },

    isMaximized(): Promise<boolean> {
      return nativeWindow?.isMaximized() ?? Promise.resolve(false);
    },

    onResized(handler: () => void): Promise<() => void> {
      return nativeWindow?.onResized(handler) ?? Promise.resolve(() => undefined);
    },

    onCloseRequested(
      handler: (event: { preventDefault(): void }) => void | Promise<void>,
    ): Promise<() => void> {
      return nativeWindow?.onCloseRequested(handler) ?? Promise.resolve(() => undefined);
    },
  };
}

const isNativeWindow =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const nativeWindow = isNativeWindow
  ? (getCurrentWindow() as NativeWindowPort)
  : null;

export const windowControls = createWindowControls(nativeWindow);
