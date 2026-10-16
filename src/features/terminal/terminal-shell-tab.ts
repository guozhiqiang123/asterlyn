import type { TerminalCommandAction } from "../../application/commands/terminal-command-ids.ts";
import type { TerminalCopy } from "../../localization/catalog.ts";
import type { TerminalBridge } from "../../protocol/terminal.ts";
import { TerminalController } from "./terminal-controller.ts";
import {
  renderTerminalHeader,
  terminalActionAvailable,
  terminalInteractionMode,
} from "./terminal-presentation.ts";
import { TerminalView } from "./terminal-view.ts";

export interface TerminalShellTabFeedback {
  readonly status: (message: string, kind: "normal" | "busy" | "warning" | "success") => void;
  readonly error: (error: unknown) => void;
  readonly keyboard?: (event: KeyboardEvent) => boolean;
  readonly changed: () => void;
}

export class TerminalShellTab {
  readonly view = new TerminalView();
  private readonly controller: TerminalController;
  private readonly feedback: TerminalShellTabFeedback;
  private readonly releaseState: () => void;
  private readonly releaseOutput: () => void;
  private copy: TerminalCopy;
  private autoStart = true;

  constructor(
    bridge: TerminalBridge,
    root: string,
    copy: TerminalCopy,
    feedback: TerminalShellTabFeedback,
  ) {
    this.copy = copy;
    this.feedback = feedback;
    this.controller = new TerminalController(bridge);
    this.controller.installWorkspace(root);
    this.releaseState = this.controller.subscribe((change) => {
      this.view.setInteractionMode(terminalInteractionMode(change.state));
      this.feedback.changed();
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
    // Opening a tab is the user's request to start a shell. Do not make process startup depend on
    // the lazy renderer producing its first fitted dimensions; output remains safely buffered.
    queueMicrotask(() => this.startIfRequested(80, 24));
  }

  get state() { return this.controller.state; }

  mount(host: HTMLElement, focus: boolean): void {
    this.view.setInteractionMode(terminalInteractionMode(this.controller.state));
    this.view.mount(host, {
      ready: (cols, rows) => this.startIfRequested(cols, rows),
      input: (data) => this.controller.sendInput(data),
      resize: (cols, rows) => this.controller.resize(cols, rows),
      failure: (error) => this.controller.reportViewFailure(error),
      keyboard: this.feedback.keyboard,
    });
    const dimensions = this.view.dimensions();
    if (dimensions) this.startIfRequested(dimensions.cols, dimensions.rows);
    if (focus) this.view.reveal();
  }

  setCopy(copy: TerminalCopy): void { this.copy = copy; }
  header(): string { return renderTerminalHeader(this.controller.state, this.copy); }
  commandAvailable(action: TerminalCommandAction): boolean {
    return terminalActionAvailable(this.controller.state, action);
  }

  async executeCommand(action: TerminalCommandAction): Promise<void> {
    if (!this.commandAvailable(action)) return;
    const dimensions = this.view.dimensions() ?? { cols: 80, rows: 24 };
    if (action === "restart") {
      this.autoStart = false;
      this.view.setInteractionMode("idle");
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

  async closeTab(): Promise<void> {
    await this.controller.close();
    this.dispose();
  }

  refreshAppearance(): void { this.view.refreshAppearance(); }

  dispose(): void {
    this.releaseState();
    this.releaseOutput();
    this.controller.dispose();
    this.view.dispose();
  }

  private startIfRequested(cols: number, rows: number): void {
    if (!this.autoStart) {
      if (this.controller.state.status === "running") this.controller.resize(cols, rows);
      return;
    }
    this.autoStart = false;
    void this.controller.start(cols, rows).then(() => {
      const dimensions = this.view.dimensions();
      if (dimensions) this.controller.resize(dimensions.cols, dimensions.rows);
    });
  }
}
