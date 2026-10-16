import type { TerminalCommandAction } from "../../application/commands/terminal-command-ids.ts";
import {
  isActiveTaskTerminalStatus,
  isTerminalTaskTerminalStatus,
  type TaskTerminalSessionDescriptor,
  type TaskTerminalSessionStatus,
} from "../../application/tasks/task-terminal-session.ts";
import { icon } from "../../icons.ts";
import type { TerminalCopy } from "../../localization/catalog.ts";
import {
  EN_US_TASK_EXECUTION_COPY,
  ZH_CN_TASK_EXECUTION_COPY,
  type TaskExecutionCopy,
} from "../../localization/task-execution-copy.ts";
import type { TerminalState } from "./terminal-controller.ts";
import type { TerminalInteractionMode } from "./terminal-view.ts";

export interface TaskTerminalPresentation {
  readonly descriptor: TaskTerminalSessionDescriptor;
  readonly status: TaskTerminalSessionStatus;
  readonly error: string | null;
  readonly outputTruncated: boolean;
  readonly outputEndedWithCarriageReturn: boolean;
}

export interface NormalizedTaskTerminalOutput {
  readonly bytes: Uint8Array;
  readonly outputEndedWithCarriageReturn: boolean;
}

/** Converts pipe-style LF newlines into terminal CRLF without breaking split CRLF frames. */
export function normalizeTaskTerminalOutput(
  bytes: Uint8Array,
  outputEndedWithCarriageReturn = false,
): NormalizedTaskTerminalOutput {
  let previousWasCarriageReturn = outputEndedWithCarriageReturn;
  let insertedCarriageReturns = 0;
  for (const byte of bytes) {
    if (byte === 0x0a && !previousWasCarriageReturn) insertedCarriageReturns += 1;
    previousWasCarriageReturn = byte === 0x0d;
  }
  if (insertedCarriageReturns === 0) {
    return { bytes, outputEndedWithCarriageReturn: previousWasCarriageReturn };
  }
  const normalized = new Uint8Array(bytes.length + insertedCarriageReturns);
  let offset = 0;
  previousWasCarriageReturn = outputEndedWithCarriageReturn;
  for (const byte of bytes) {
    if (byte === 0x0a && !previousWasCarriageReturn) normalized[offset++] = 0x0d;
    normalized[offset++] = byte;
    previousWasCarriageReturn = byte === 0x0d;
  }
  return { bytes: normalized, outputEndedWithCarriageReturn: previousWasCarriageReturn };
}

export function renderTerminalHeader(state: TerminalState, copy: TerminalCopy): string {
  const summary = terminalSummary(state, copy);
  return renderTerminalActions(
    summary,
    state.cwd ?? summary,
    state.status === "error",
    copy.close,
    copy,
    (action) => terminalActionAvailable(state, action),
  );
}

export function terminalActionAvailable(
  state: TerminalState,
  action: TerminalCommandAction,
): boolean {
  if (action === "clear") return state.status !== "starting";
  if (action === "close") return state.status === "running";
  return state.status === "idle" || state.status === "exited" || state.status === "error";
}

export function renderTaskTerminalHeader(
  state: TaskTerminalPresentation,
  copy: TerminalCopy,
  taskCopy: TaskExecutionCopy = EN_US_TASK_EXECUTION_COPY,
): string {
  const summary = taskTerminalSummary(state, taskCopy);
  return renderTerminalActions(
    summary,
    state.descriptor.taskKey,
    state.status === "failed" || state.status === "crashed",
    taskCopy.cancel,
    copy,
    (action) => taskTerminalActionAvailable(state.status, action),
  );
}

export function taskTerminalActionAvailable(
  status: TaskTerminalSessionStatus,
  action: TerminalCommandAction,
): boolean {
  if (action === "clear") return true;
  if (action === "close") return isActiveTaskTerminalStatus(status);
  return false;
}

export function taskTerminalInteractionMode(
  status: TaskTerminalSessionStatus,
): TerminalInteractionMode {
  return isTerminalTaskTerminalStatus(status) ? "idle" : "task-running";
}

export function terminalInteractionMode(state: TerminalState): TerminalInteractionMode {
  return state.status === "starting" || state.status === "running" ? "interactive" : "idle";
}

export function shouldAutoStartShell(hasTaskSession: boolean, state: TerminalState): boolean {
  return !hasTaskSession && state.status === "idle";
}

export function taskTerminalCommandLine(session: TaskTerminalSessionDescriptor): string {
  const parts = [session.executablePath, ...session.args].map((value) => JSON.stringify(value));
  return `\r\n\x1b[90m# ${sanitizeTerminalText(session.label)}\r\n> ${parts.join(" ")}\x1b[0m\r\n\r\n`;
}

export function terminalTaskCopy(locale: "en-US" | "zh-CN"): TaskExecutionCopy {
  return locale === "zh-CN" ? ZH_CN_TASK_EXECUTION_COPY : EN_US_TASK_EXECUTION_COPY;
}

export function decodeTerminalBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function terminalSummary(state: TerminalState, copy: TerminalCopy): string {
  if (state.status === "starting") return copy.starting;
  if (state.status === "running") return state.shell ?? copy.running;
  if (state.status === "exited" && state.exitCode !== null) return copy.exited(state.exitCode);
  if (state.status === "error") return copy.failed;
  return copy.notRunning;
}

function renderTerminalActions(
  summary: string,
  title: string,
  error: boolean,
  closeLabel: string,
  copy: TerminalCopy,
  available: (action: TerminalCommandAction) => boolean,
): string {
  const button = (
    action: TerminalCommandAction,
    label: string,
    glyph: "refresh" | "trash" | "stop",
    size: number,
  ) => `<button class="compact-icon-button" type="button" data-terminal-action="${action}" aria-label="${escapeAttribute(label)}" title="${escapeAttribute(label)}" ${available(action) ? "" : "disabled"}>${icon(glyph, size)}</button>`;
  return `<span class="terminal-session-status ${error ? "error" : ""}" title="${escapeAttribute(title)}">${escapeHtml(summary)}</span>
    ${button("restart", copy.newSession, "refresh", 15)}
    ${button("clear", copy.clear, "trash", 15)}
    ${button("close", closeLabel, "stop", 14)}`;
}

export function taskTerminalSummary(state: TaskTerminalPresentation, copy: TaskExecutionCopy): string {
  const summary = `${state.descriptor.label} — ${copy.status[state.status] ?? state.status}`;
  return state.error ? `${summary} — ${sanitizeTerminalText(state.error)}` : summary;
}

function sanitizeTerminalText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").trim();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
