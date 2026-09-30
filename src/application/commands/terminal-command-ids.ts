import { commandId } from "./command-service.ts";

export type TerminalCommandAction = "restart" | "clear" | "close";

export const TERMINAL_COMMANDS = {
  restart: commandId("terminal.session.restart"),
  clear: commandId("terminal.clear"),
  close: commandId("terminal.session.close"),
} as const;
