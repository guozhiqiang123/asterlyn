import type { WorkspaceWatchStatus } from "../../models.ts";
import {
  parseWorkspaceWatchInvalidation,
  WORKSPACE_WATCH_EVENT,
  type WorkspaceWatchBridge,
} from "../../protocol/workspace-watch.ts";
import { invokeDesktopCommand } from "./desktop-command-adapter.ts";

export const tauriWorkspaceWatchBridge: WorkspaceWatchBridge = {
  native: true,
  start: (workspaceRoot, generation) =>
    invokeDesktopCommand<WorkspaceWatchStatus>("start_workspace_watch", {
      workspaceRoot,
      generation,
    }),
  stop: () => invokeDesktopCommand<void>("stop_workspace_watch"),
  async subscribe(listener) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<unknown>(WORKSPACE_WATCH_EVENT, (event) => {
      listener(parseWorkspaceWatchInvalidation(event.payload));
    });
  },
};
