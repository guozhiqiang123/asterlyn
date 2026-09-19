import type { RuntimeScheduler } from "../../application/runtime-scheduler.ts";
import type { WorkspaceFocusPort } from "../../application/workspace-watch-coordinator.ts";

export const browserRuntimeScheduler: RuntimeScheduler = {
  schedule(task, delayMs) {
    return window.setTimeout(task, delayMs);
  },
  cancel(task) {
    window.clearTimeout(task as number);
  },
};

export const browserWindowFocusPort: WorkspaceFocusPort = {
  subscribe(onBlur, onFocus) {
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  },
};
