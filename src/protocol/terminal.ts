import type { TerminalEvent, TerminalStarted } from "../models.ts";

export const TERMINAL_EVENT = "terminal-session-event";

export interface TerminalBridge {
  readonly native: boolean;
  startTerminal(workspaceRoot: string, cols: number, rows: number): Promise<TerminalStarted>;
  writeTerminal(sessionId: string, dataBase64: string): Promise<void>;
  resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void>;
  closeTerminal(sessionId: string): Promise<boolean>;
  subscribeTerminal(listener: (event: TerminalEvent) => void): Promise<() => void>;
}

export function parseTerminalEvent(value: unknown): TerminalEvent {
  if (!isRecord(value) || value.protocolVersion !== 1) {
    throw new Error("Terminal event has an unsupported protocol version.");
  }
  if (typeof value.sessionId !== "string" || !value.sessionId) {
    throw new Error("Terminal event has no session identity.");
  }
  if (value.kind === "output") {
    if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) {
      throw new Error("Terminal output has an invalid sequence.");
    }
    if (typeof value.dataBase64 !== "string") {
      throw new Error("Terminal output has invalid data.");
    }
    return value as TerminalEvent;
  }
  if (value.kind === "exited") {
    if (!Number.isSafeInteger(value.exitCode) || (value.exitCode as number) < 0) {
      throw new Error("Terminal exit has an invalid code.");
    }
    if (!(value.signal === null || typeof value.signal === "string")) {
      throw new Error("Terminal exit has an invalid signal.");
    }
    return value as TerminalEvent;
  }
  if (value.kind === "error") {
    if (typeof value.message !== "string" || !value.message) {
      throw new Error("Terminal failure has no message.");
    }
    return value as TerminalEvent;
  }
  throw new Error("Terminal event has an unknown kind.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
