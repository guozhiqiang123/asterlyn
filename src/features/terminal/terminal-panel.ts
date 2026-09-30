import type { TerminalCopy } from "../../localization/catalog.ts";
import type { TerminalBridge } from "../../protocol/terminal.ts";
import type { TerminalCommandAction } from "../../application/commands/terminal-command-ids.ts";
import { icon } from "../../icons.ts";
import { TerminalController, type TerminalState } from "./terminal-controller.ts";
import { TerminalView } from "./terminal-view.ts";

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
  private visible = false;

  constructor(
    root: HTMLElement,
    bridge: TerminalBridge,
    copy: TerminalCopy,
    feedback: TerminalPanelFeedback,
  ) {
    this.root = root;
    this.feedback = feedback;
    this.copy = copy;
    this.controller = new TerminalController(bridge);
    this.releaseState = this.controller.subscribe((change) => {
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
      if (frame.kind === "output") this.view.write(frame.bytes);
      else this.view.write(new TextEncoder().encode(this.copy.outputTruncated(frame.omittedBytes)));
    });
  }

  installWorkspace(root: string): void {
    const changed = this.controller.state.root !== root;
    this.controller.installWorkspace(root);
    if (changed) this.view.reset();
  }

  activate(root: string): void {
    this.visible = true;
    this.installWorkspace(root);
    const host = this.root.querySelector<HTMLElement>("#terminal-tool-host");
    if (!host) return;
    this.bindHeader();
    this.renderHeader();
    this.view.mount(host, {
      ready: (cols, rows) => void this.controller.start(cols, rows),
      input: (data) => this.controller.sendInput(data),
      resize: (cols, rows) => this.controller.resize(cols, rows),
      failure: (error) => this.controller.reportViewFailure(error),
      keyboard: this.feedback.keyboard,
    });
    const dimensions = this.view.dimensions();
    if (dimensions && this.controller.state.status === "idle") {
      void this.controller.start(dimensions.cols, dimensions.rows);
    }
    this.view.reveal();
  }

  hide(): void {
    this.visible = false;
  }

  setCopy(copy: TerminalCopy): void {
    this.copy = copy;
    if (this.visible) this.renderHeader();
  }

  refreshAppearance(): void {
    this.view.refreshAppearance();
  }

  commandAvailable(action: TerminalCommandAction): boolean {
    return this.visible && terminalActionAvailable(this.controller.state, action);
  }

  async executeCommand(action: TerminalCommandAction): Promise<void> {
    if (!this.commandAvailable(action)) return;
    const dimensions = this.view.dimensions() ?? { cols: 80, rows: 24 };
    if (action === "restart") {
      this.view.reset();
      await this.controller.restart(dimensions.cols, dimensions.rows);
    } else if (action === "clear") {
      this.view.clear();
      this.feedback.status(this.copy.cleared, "success");
    } else {
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
    actions.innerHTML = renderTerminalHeader(this.controller.state, this.copy);
    this.feedback.presentationChanged?.();
  }
}

export function renderTerminalHeader(state: TerminalState, copy: TerminalCopy): string {
  const summary = terminalSummary(state, copy);
  const canClear = terminalActionAvailable(state, "clear");
  const canClose = terminalActionAvailable(state, "close");
  const canRestart = terminalActionAvailable(state, "restart");
  return `<span class="terminal-session-status ${state.status === "error" ? "error" : ""}" title="${escapeAttribute(state.cwd ?? summary)}">${escapeHtml(summary)}</span>
    <button class="compact-icon-button" type="button" data-terminal-action="restart" aria-label="${escapeAttribute(copy.newSession)}" title="${escapeAttribute(copy.newSession)}" ${canRestart ? "" : "disabled"}>${icon("refresh", 15)}</button>
    <button class="compact-icon-button" type="button" data-terminal-action="clear" aria-label="${escapeAttribute(copy.clear)}" title="${escapeAttribute(copy.clear)}" ${canClear ? "" : "disabled"}>${icon("trash", 15)}</button>
    <button class="compact-icon-button" type="button" data-terminal-action="close" aria-label="${escapeAttribute(copy.close)}" title="${escapeAttribute(copy.close)}" ${canClose ? "" : "disabled"}>${icon("stop", 14)}</button>`;
}

export function terminalActionAvailable(state: TerminalState, action: TerminalCommandAction): boolean {
  if (action === "clear") return state.status !== "starting";
  if (action === "close") return state.status === "running";
  return state.status === "idle" || state.status === "exited" || state.status === "error";
}

function terminalSummary(state: TerminalState, copy: TerminalCopy): string {
  if (state.status === "starting") return copy.starting;
  if (state.status === "running") return state.shell ?? copy.running;
  if (state.status === "exited" && state.exitCode !== null) return copy.exited(state.exitCode);
  if (state.status === "error") return copy.failed;
  return copy.notRunning;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
