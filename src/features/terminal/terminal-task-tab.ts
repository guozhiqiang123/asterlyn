import type { TerminalCommandAction } from "../../application/commands/terminal-command-ids.ts";
import {
  isActiveTaskTerminalStatus,
  isTerminalTaskTerminalStatus,
  type TaskTerminalOutputFrame,
  type TaskTerminalSessionDescriptor,
  type TaskTerminalSessionStatus,
} from "../../application/tasks/task-terminal-session.ts";
import type { TerminalCopy } from "../../localization/catalog.ts";
import type { TaskExecutionCopy } from "../../localization/task-execution-copy.ts";
import {
  decodeTerminalBase64,
  normalizeTaskTerminalOutput,
  renderTaskTerminalHeader,
  taskTerminalActionAvailable,
  taskTerminalCommandLine,
  taskTerminalInteractionMode,
  type TaskTerminalPresentation,
} from "./terminal-presentation.ts";
import { TerminalView } from "./terminal-view.ts";

export interface TerminalTaskTabFeedback {
  readonly error: (error: unknown) => void;
  readonly keyboard?: (event: KeyboardEvent) => boolean;
}

export class TerminalTaskTab {
  readonly view = new TerminalView();
  private readonly feedback: TerminalTaskTabFeedback;
  private presentation: TaskTerminalPresentation;

  constructor(
    descriptor: TaskTerminalSessionDescriptor,
    feedback: TerminalTaskTabFeedback,
  ) {
    this.feedback = feedback;
    this.presentation = {
      descriptor,
      status: "starting",
      error: null,
      outputTruncated: false,
      outputEndedWithCarriageReturn: false,
    };
    this.view.setInteractionMode("task-running");
    this.view.write(new TextEncoder().encode(taskTerminalCommandLine(descriptor)));
  }

  get descriptor(): TaskTerminalSessionDescriptor { return this.presentation.descriptor; }
  get status(): TaskTerminalSessionStatus { return this.presentation.status; }
  get terminal(): boolean { return isTerminalTaskTerminalStatus(this.presentation.status); }

  mount(host: HTMLElement, focus: boolean): void {
    this.view.setInteractionMode(taskTerminalInteractionMode(this.presentation.status));
    this.view.mount(host, {
      ready: () => undefined,
      input: () => undefined,
      resize: () => undefined,
      failure: this.feedback.error,
      keyboard: this.feedback.keyboard,
    });
    if (focus) this.view.reveal();
  }

  append(frame: TaskTerminalOutputFrame): void {
    try {
      const normalized = normalizeTaskTerminalOutput(
        decodeTerminalBase64(frame.dataBase64),
        this.presentation.outputEndedWithCarriageReturn,
      );
      this.presentation = {
        ...this.presentation,
        outputEndedWithCarriageReturn: normalized.outputEndedWithCarriageReturn,
      };
      this.view.write(normalized.bytes);
    } catch (error) {
      this.feedback.error(error);
    }
  }

  update(
    status: TaskTerminalSessionStatus,
    error: string | null,
    outputTruncated: boolean,
    truncatedCopy: string,
  ): void {
    const wasTerminal = isTerminalTaskTerminalStatus(this.presentation.status);
    const becameTruncated = outputTruncated && !this.presentation.outputTruncated;
    this.presentation = { ...this.presentation, status, error, outputTruncated };
    if (becameTruncated) {
      this.view.write(new TextEncoder().encode(`\r\n[${truncatedCopy}]\r\n`));
    }
    if (!wasTerminal && isTerminalTaskTerminalStatus(status)) {
      this.view.write(new TextEncoder().encode("\r\n"));
    }
    this.view.setInteractionMode(taskTerminalInteractionMode(status));
  }

  header(copy: TerminalCopy, taskCopy: TaskExecutionCopy): string {
    return renderTaskTerminalHeader(this.presentation, copy, taskCopy);
  }

  commandAvailable(action: TerminalCommandAction): boolean {
    return taskTerminalActionAvailable(this.presentation.status, action);
  }

  async executeCommand(action: TerminalCommandAction): Promise<void> {
    if (!this.commandAvailable(action)) return;
    if (action === "clear") this.view.clear();
    else if (action === "close" && isActiveTaskTerminalStatus(this.presentation.status)) {
      await this.presentation.descriptor.cancel();
    }
  }

  async requestTabClose(): Promise<boolean> {
    if (isActiveTaskTerminalStatus(this.presentation.status)) {
      await this.presentation.descriptor.cancel();
      return false;
    }
    this.dispose();
    return true;
  }

  refreshAppearance(): void { this.view.refreshAppearance(); }
  dispose(): void { this.view.dispose(); }
}
