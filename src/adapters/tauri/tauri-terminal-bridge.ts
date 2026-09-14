import type { TerminalStarted } from "../../models.ts";
import {
  parseTerminalEvent,
  TERMINAL_EVENT,
  type TerminalBridge,
} from "../../protocol/terminal.ts";
import { invokeDesktopCommand } from "./desktop-command-adapter.ts";

export const tauriTerminalBridge: TerminalBridge = {
  native: true,
  startTerminal: (workspaceRoot, cols, rows) =>
    invokeDesktopCommand<TerminalStarted>("start_terminal", { workspaceRoot, cols, rows }),
  writeTerminal: (sessionId, dataBase64) =>
    invokeDesktopCommand<void>("write_terminal", { sessionId, dataBase64 }),
  resizeTerminal: (sessionId, cols, rows) =>
    invokeDesktopCommand<void>("resize_terminal", { sessionId, cols, rows }),
  closeTerminal: (sessionId) => invokeDesktopCommand<boolean>("close_terminal", { sessionId }),
  async subscribeTerminal(listener) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<unknown>(TERMINAL_EVENT, (event) => {
      listener(parseTerminalEvent(event.payload));
    });
  },
};
