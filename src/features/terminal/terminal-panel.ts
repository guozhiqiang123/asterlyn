import type { TerminalCopy } from "../../localization/catalog.ts";
import { EN_US_TASK_EXECUTION_COPY, ZH_CN_TASK_EXECUTION_COPY, type TaskExecutionCopy } from "../../localization/task-execution-copy.ts";
import type { TerminalBridge } from "../../protocol/terminal.ts";
import type { TerminalCommandAction } from "../../application/commands/terminal-command-ids.ts";
import {
  isActiveTaskTerminalStatus,
  isTerminalTaskTerminalStatus,
  type TaskTerminalOutputFrame,
  type TaskTerminalSessionDescriptor,
  type TaskTerminalSessionPort,
  type TaskTerminalSessionStatus,
} from "../../application/tasks/task-terminal-session.ts";
import { icon } from "../../icons.ts";
import { TerminalController, type TerminalState } from "./terminal-controller.ts";
import { TerminalView, type TerminalInteractionMode } from "./terminal-view.ts";

interface TerminalPanelFeedback {
  readonly status: (message: string, kind: "normal" | "busy" | "warning" | "success") => void;
  readonly error: (error: unknown) => void;
  readonly keyboard?: (event: KeyboardEvent) => boolean;
  readonly presentationChanged?: () => void;
}

export class TerminalPanel {
  private readonly root: HTMLElement;
  private readonly feedback: TerminalPanelFeedback;
  private readonly controller: TerminalController;
  private readonly view = new TerminalView();
  private readonly releaseState: () => void;
  private readonly releaseOutput: () => void;
  private copy: TerminalCopy;
  private taskCopy: TaskExecutionCopy;
  private visible = false;
  private taskSession: TaskTerminalPresentation | null = null;
  private autoStartShell = false;

  constructor(
    root: HTMLElement,
    bridge: TerminalBridge,
    copy: TerminalCopy,
    feedback: TerminalPanelFeedback,
    locale: "en-US" | "zh-CN" = "en-US",
  ) {
    this.root = root;
    this.feedback = feedback;
    this.copy = copy;
    this.taskCopy = terminalTaskCopy(locale);
    this.controller = new TerminalController(bridge);
    this.releaseState = this.controller.subscribe((change) => {
      if (!this.taskSession) this.view.setInteractionMode(terminalInteractionMode(change.state));
      this.renderHeader();
      if (change.reason === "starting") this.feedback.status(this.copy.starting, "busy");
      if (change.reason === "started" && change.state.shell) {
        this.feedback.status(this.copy.started(change.state.shell), "success");
      }
      if (change.reason === "exited" && change.state.exitCode !== null) {
        this.feedback.status(this.copy.exited(change.state.exitCode), "normal");
      }
      if (change.reason === "error" && change.state.error) {
        this.feedback.error(new Error(change.state.error));
      }
    });
    this.releaseOutput = this.controller.subscribeOutput((frame) => {
      if (this.taskSession) return;
      if (frame.kind === "output") this.view.write(frame.bytes);
      else this.view.write(new TextEncoder().encode(this.copy.outputTruncated(frame.omittedBytes)));
    });
  }

  installWorkspace(root: string): void {
    const changed = this.controller.state.root !== root;
    if (changed && this.taskSession?.descriptor.workspaceRoot !== root) {
      this.taskSession = null;
      this.view.setInteractionMode("idle");
    }
    this.controller.installWorkspace(root);
    if (changed) {
      this.view.reset();
      this.view.setInteractionMode(this.taskSession ? "task-running" : terminalInteractionMode(this.controller.state));
    }
  }

  activate(root: string): void {
    this.visible = true;
    this.installWorkspace(root);
    this.autoStartShell = shouldAutoStartShell(this.taskSession !== null, this.controller.state);
    const host = this.root.querySelector<HTMLElement>("#terminal-tool-host");
    if (!host) return;
    this.bindHeader();
    this.renderHeader();
    this.view.setInteractionMode(this.taskSession ? "task-running" : terminalInteractionMode(this.controller.state));
    this.view.mount(host, {
      ready: (cols, rows) => this.startShellIfRequested(cols, rows),
      input: (data) => { if (!this.taskSession) this.controller.sendInput(data); },
      resize: (cols, rows) => { if (!this.taskSession) this.controller.resize(cols, rows); },
      failure: (error) => this.controller.reportViewFailure(error),
      keyboard: this.feedback.keyboard,
    });
    const dimensions = this.view.dimensions();
    if (dimensions) this.startShellIfRequested(dimensions.cols, dimensions.rows);
    this.view.reveal();
  }

  hide(): void {
    this.visible = false;
  }

  setCopy(copy: TerminalCopy, locale: "en-US" | "zh-CN" = "en-US"): void {
    this.copy = copy;
    this.taskCopy = terminalTaskCopy(locale);
    if (this.visible) this.renderHeader();
  }

  refreshAppearance(): void {
    this.view.refreshAppearance();
  }

  beginTask(session: TaskTerminalSessionDescriptor): void {
    this.installWorkspace(session.workspaceRoot);
    this.autoStartShell = false;
    this.taskSession = { descriptor: session, status: "starting", error: null, outputTruncated: false, outputEndedWithCarriageReturn: false };
    this.view.reset();
    this.view.setInteractionMode("task-running");
    this.view.write(new TextEncoder().encode(taskTerminalCommandLine(session)));
    void this.controller.close().catch((error) => this.feedback.error(error));
    this.renderHeader();
    this.feedback.status(taskTerminalSummary(this.taskSession, this.taskCopy), "busy");
  }

  appendTask(sessionId: string, frame: TaskTerminalOutputFrame): void {
    const current = this.taskSession;
    if (current?.descriptor.sessionId !== sessionId) return;
    try {
      const normalized = normalizeTaskTerminalOutput(
        decodeBase64(frame.dataBase64),
        current.outputEndedWithCarriageReturn,
      );
      this.taskSession = { ...current, outputEndedWithCarriageReturn: normalized.outputEndedWithCarriageReturn };
      this.view.write(normalized.bytes);
    } catch (error) {
      this.feedback.error(error);
    }
  }

  updateTask(
    sessionId: string,
    status: TaskTerminalSessionStatus,
    error: string | null,
    outputTruncated: boolean,
  ): void {
    const current = this.taskSession;
    if (!current || current.descriptor.sessionId !== sessionId) return;
    const becameTruncated = outputTruncated && !current.outputTruncated;
    const next = { ...current, status, error, outputTruncated };
    const summary = taskTerminalSummary(next, this.taskCopy);
    this.taskSession = next;
    if (becameTruncated) this.view.write(new TextEncoder().encode(`\r\n[${sanitizeTerminalText(this.taskCopy.outputTruncated)}]\r\n`));
    if (isTerminalTaskTerminalStatus(status)) {
      this.taskSession = null;
      this.autoStartShell = false;
      this.view.reset();
    }
    this.view.setInteractionMode(taskTerminalInteractionMode(status));
    this.renderHeader();
    const kind = status === "succeeded" ? "success" : isActiveTaskTerminalStatus(status) ? "busy" : status === "cancelled" ? "normal" : "warning";
    this.feedback.status(summary, kind);
  }

  revealTask(sessionId: string): boolean {
    if (this.taskSession?.descriptor.sessionId !== sessionId) return false;
    this.view.reveal();
    return true;
  }

  commandAvailable(action: TerminalCommandAction): boolean {
    return this.visible && (this.taskSession
      ? taskTerminalActionAvailable(this.taskSession.status, action)
      : terminalActionAvailable(this.controller.state, action));
  }

  async executeCommand(action: TerminalCommandAction): Promise<void> {
    if (!this.commandAvailable(action)) return;
    const dimensions = this.view.dimensions() ?? { cols: 80, rows: 24 };
    if (action === "restart") {
      this.taskSession = null;
      this.autoStartShell = false;
      this.view.setInteractionMode("idle");
      this.view.reset();
      await this.controller.restart(dimensions.cols, dimensions.rows);
    } else if (action === "clear") {
      this.view.clear();
      this.feedback.status(this.copy.cleared, "success");
    } else {
      if (this.taskSession && isActiveTaskTerminalStatus(this.taskSession.status)) {
        await this.taskSession.descriptor.cancel();
        return;
      }
      await this.controller.close();
      this.feedback.status(this.copy.closed, "success");
    }
  }

  dispose(): void {
    this.releaseState();
    this.releaseOutput();
    this.controller.dispose();
    this.view.dispose();
  }

  private bindHeader(): void {
    const actions = this.root.querySelector<HTMLElement>("#terminal-header-actions");
    if (!actions || actions.dataset.bound === "true") return;
    actions.dataset.bound = "true";
    actions.addEventListener("click", (event) => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-terminal-action]");
      if (!button || !actions.contains(button)) return;
      const action = button.dataset.terminalAction;
      if (action === "restart" || action === "clear" || action === "close") void this.executeCommand(action);
    });
  }

  private renderHeader(): void {
    const actions = this.root.querySelector<HTMLElement>("#terminal-header-actions");
    if (!actions) return;
    actions.classList.toggle("hidden", !this.visible);
    actions.innerHTML = this.taskSession
      ? renderTaskTerminalHeader(this.taskSession, this.copy, this.taskCopy)
      : renderTerminalHeader(this.controller.state, this.copy);
    this.feedback.presentationChanged?.();
  }

  private startShellIfRequested(cols: number, rows: number): void {
    if (!this.autoStartShell || this.taskSession) return;
    this.autoStartShell = false;
    void this.controller.start(cols, rows);
  }
}

interface TaskTerminalPresentation {
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

export function taskTerminalPort(panel: TerminalPanel): TaskTerminalSessionPort {
  return {
    begin: (session) => panel.beginTask(session),
    append: (sessionId, frame) => panel.appendTask(sessionId, frame),
    update: (sessionId, status, error, outputTruncated) => panel.updateTask(sessionId, status, error, outputTruncated),
    reveal: (sessionId) => panel.revealTask(sessionId),
  };
}

export function renderTerminalHeader(state: TerminalState, copy: TerminalCopy): string {
  const summary = terminalSummary(state, copy);
  return renderTerminalActions(summary, state.cwd ?? summary, state.status === "error", copy.close, copy, (action) => terminalActionAvailable(state, action));
}

export function terminalActionAvailable(state: TerminalState, action: TerminalCommandAction): boolean {
  if (action === "clear") return state.status !== "starting";
  if (action === "close") return state.status === "running";
  return state.status === "idle" || state.status === "exited" || state.status === "error";
}

export function renderTaskTerminalHeader(state: TaskTerminalPresentation, copy: TerminalCopy, taskCopy: TaskExecutionCopy = EN_US_TASK_EXECUTION_COPY): string {
  const summary = taskTerminalSummary(state, taskCopy);
  return renderTerminalActions(summary, state.descriptor.taskKey, state.status === "failed" || state.status === "crashed", taskCopy.cancel, copy, (action) => taskTerminalActionAvailable(state.status, action));
}

export function taskTerminalActionAvailable(status: TaskTerminalSessionStatus, action: TerminalCommandAction): boolean {
  if (action === "clear") return true;
  if (action === "close") return isActiveTaskTerminalStatus(status);
  return isTerminalTaskTerminalStatus(status);
}

export function taskTerminalInteractionMode(status: TaskTerminalSessionStatus): TerminalInteractionMode {
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
  return `\x1b[90m# ${sanitizeTerminalText(session.label)}\r\n> ${parts.join(" ")}\x1b[0m\r\n\r\n`;
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
  const button = (action: TerminalCommandAction, label: string, glyph: "refresh" | "trash" | "stop", size: number) =>
    `<button class="compact-icon-button" type="button" data-terminal-action="${action}" aria-label="${escapeAttribute(label)}" title="${escapeAttribute(label)}" ${available(action) ? "" : "disabled"}>${icon(glyph, size)}</button>`;
  return `<span class="terminal-session-status ${error ? "error" : ""}" title="${escapeAttribute(title)}">${escapeHtml(summary)}</span>
    ${button("restart", copy.newSession, "refresh", 15)}
    ${button("clear", copy.clear, "trash", 15)}
    ${button("close", closeLabel, "stop", 14)}`;
}

function taskTerminalSummary(state: TaskTerminalPresentation, copy: TaskExecutionCopy): string {
  const summary = `${state.descriptor.label} — ${copy.status[state.status] ?? state.status}`;
  return state.error ? `${summary} — ${sanitizeTerminalText(state.error)}` : summary;
}

function terminalTaskCopy(locale: "en-US" | "zh-CN"): TaskExecutionCopy {
  return locale === "zh-CN" ? ZH_CN_TASK_EXECUTION_COPY : EN_US_TASK_EXECUTION_COPY;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
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
