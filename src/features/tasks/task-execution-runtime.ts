import type {
  TaskExecutionController,
  TaskExecutionState,
  TaskWorkspaceIdentity,
} from "../../application/tasks/task-execution-controller.ts";
import type { TaskExecutionRequest } from "../../models.ts";
import type {
  TaskTerminalSessionPort,
  TaskTerminalSessionStatus,
} from "../../application/tasks/task-terminal-session.ts";
import type { PluginTaskExecutionResult } from "../../application/plugins/plugin-types.ts";
import type { TaskArtifact, TaskArtifactDiscovery } from "../../models.ts";
import { EN_US_TASK_EXECUTION_COPY, type TaskExecutionCopy } from "../../localization/task-execution-copy.ts";
import { renderTaskExecutionReview, type TaskArtifactViewState, type TaskConfirmationPresentation } from "./task-execution-view.ts";

export interface TaskExecutionRuntimeOptions {
  readonly retry?: (identity: TaskWorkspaceIdentity, taskKey: string) => void;
  readonly revealArtifact?: (identity: TaskWorkspaceIdentity, artifact: TaskArtifact) => void | Promise<void>;
  readonly reportError?: (error: unknown) => void;
  readonly visibilityChanged?: () => void;
  readonly backgroundAfterStart?: (request: TaskExecutionRequest) => boolean;
  readonly executionTimeoutMs?: (request: TaskExecutionRequest) => number | null;
  readonly taskConfirmation?: (request: TaskExecutionRequest) => TaskConfirmationPresentation | null;
  readonly taskTerminal?: TaskTerminalSessionPort;
}

export type TaskExecutionPresentation = "background" | "terminal";

export interface TaskArtifactAttachmentTarget {
  readonly root: string;
  readonly generation: number;
  readonly taskKey: string;
  readonly presentationVersion: number;
}

export interface TaskArtifactAttachmentState {
  readonly identity: TaskWorkspaceIdentity | null;
  readonly taskKey: string | null;
  readonly presentationVersion: number;
  readonly visible: boolean;
  readonly succeeded: boolean;
}

export function taskArtifactAttachmentMatches(
  target: TaskArtifactAttachmentTarget,
  state: TaskArtifactAttachmentState,
): boolean {
  return state.succeeded && state.presentationVersion === target.presentationVersion &&
    state.identity?.root === target.root && state.identity.generation === target.generation &&
    state.taskKey === target.taskKey;
}

export class TaskExecutionRuntime {
  private identity: TaskWorkspaceIdentity | null = null;
  private readonly unsubscribe: () => void;
  private readonly root: HTMLElement;
  private readonly controller: TaskExecutionController;
  private readonly copy: () => TaskExecutionCopy;
  private readonly options: TaskExecutionRuntimeOptions;
  private readonly listeners = new AbortController();
  private focusReturn: HTMLElement | null = null;
  private visible = false;
  private terminalState: TaskExecutionState | null = null;
  private artifactState: TaskArtifactViewState | null = null;
  private presentationVersion = 0;
  private finished: ((result: PluginTaskExecutionResult) => void) | null = null;
  private backgroundOnStart = false;
  private executionTimeoutMs: number | null = null;
  private executionTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private taskConfirmation: TaskConfirmationPresentation | null = null;
  private executionPresentation: TaskExecutionPresentation = "background";
  private projectedTerminalSessionId: string | null = null;
  private projectedTerminalOutputCount = 0;

  constructor(
    root: HTMLElement,
    controller: TaskExecutionController,
    copy: () => TaskExecutionCopy = () => EN_US_TASK_EXECUTION_COPY,
    options: TaskExecutionRuntimeOptions = {},
  ) {
    this.root = root;
    this.controller = controller;
    this.copy = copy;
    this.options = options;
    this.unsubscribe = controller.subscribe((state) => {
      this.projectTaskTerminal(state);
      this.observeTerminal(state);
      this.backgroundStartedExecution(state);
      this.render();
    });
    root.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-task-execution-action]");
      if (!target || !this.identity) return;
      const action = target.dataset.taskExecutionAction;
      if (action === "confirm") {
        const remember = this.host()?.querySelector<HTMLInputElement>("[data-task-execution-remember]")?.checked === true;
        void controller.confirm(this.identity, remember).catch((error) => this.fail(error));
      }
      else if (action === "cancel") void controller.cancel(this.identity).catch((error) => this.fail(error));
      else if (action === "trust") void controller.setWorkspaceTrust(this.identity, "trusted").catch((error) => this.fail(error));
      else if (action === "deny") void controller.setWorkspaceTrust(this.identity, "denied").catch((error) => this.fail(error));
      else if (action === "close") this.dismiss();
      else if (action === "retry") this.retry();
      else if (action === "reveal-artifact") this.revealArtifact(target.dataset.taskArtifactIndex);
    }, { signal: this.listeners.signal });
    root.addEventListener("keydown", (event) => {
      if (!this.identity || !this.visible) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (isTerminal(this.displayState())) this.dismiss();
        else void this.controller.cancel(this.identity).catch((error) => this.fail(error));
      } else if (event.key === "Tab") {
        const host = this.host();
        if (host) trapFocus(host, event);
      }
    }, { signal: this.listeners.signal });
  }

  get active(): boolean { return this.visible; }

  activate(identity: TaskWorkspaceIdentity): void {
    if (this.finished) {
      const finished = this.finished;
      this.finished = null;
      finished({ status: "cancelled", outputs: [], truncated: false, error: "Task execution was superseded by a workspace change." });
    }
    this.identity = identity;
    this.visible = false;
    this.backgroundOnStart = false;
    this.clearExecutionTimer();
    this.executionTimeoutMs = null;
    this.taskConfirmation = null;
    this.executionPresentation = "background";
    this.resetTaskTerminalProjection();
    this.terminalState = null;
    this.invalidateArtifacts();
    this.controller.activateWorkspace(identity);
    this.render();
  }

  async prepare(
    identity: TaskWorkspaceIdentity,
    request: TaskExecutionRequest,
    finished: (result: PluginTaskExecutionResult) => void,
    presentation: TaskExecutionPresentation = "background",
  ): Promise<void> {
    if (this.finished) throw new Error("A task execution review is already active.");
    this.identity = identity;
    this.finished = finished;
    this.backgroundOnStart = this.options.backgroundAfterStart?.(request) === true;
    this.executionTimeoutMs = this.options.executionTimeoutMs?.(request) ?? null;
    this.taskConfirmation = this.options.taskConfirmation?.(request) ?? null;
    this.executionPresentation = presentation;
    this.resetTaskTerminalProjection();
    this.terminalState = null;
    this.invalidateArtifacts();
    try {
      const review = await this.controller.prepare(identity, request, this.taskConfirmation !== null);
      if (review.trust === "trusted" && this.controller.state.confirmationMemory === "remembered") {
        await this.controller.confirm(identity, false);
        return;
      }
    } catch (error) {
      if (this.controller.state.status === "starting") this.fail(error);
      if (this.finished === finished) this.finished = null;
      this.visible = false;
      this.backgroundOnStart = false;
      this.clearExecutionTimer();
      this.options.visibilityChanged?.();
      throw error;
    }
    if (this.finished === finished) {
      this.open();
      this.render();
    }
  }

  reveal(taskKey: string, identity: TaskWorkspaceIdentity): boolean {
    const review = this.terminalState?.review;
    if (!review || !sameIdentity(this.identity, identity) || executionTaskKey(review) !== taskKey) return false;
    if (this.executionPresentation === "terminal" && this.options.taskTerminal?.reveal(review.reviewId)) return true;
    this.open();
    this.render();
    return true;
  }

  render(): void {
    const host = this.host();
    if (!host) return;
    const state = this.displayState();
    if (!this.visible || !state?.review) {
      if (host.querySelector(".task-execution-review")) host.replaceChildren();
      return;
    }
    const focusedAction = host.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.taskExecutionAction ?? null
      : null;
    host.innerHTML = renderTaskExecutionReview(state, this.copy(), this.artifactState, this.taskConfirmation);
    queueMicrotask(() => {
      const preferred = focusedAction
        ? host.querySelector<HTMLElement>(`[data-task-execution-action="${focusedAction}"]`)
        : null;
      (preferred ?? host.querySelector<HTMLElement>("[data-host-default-focus]:not([disabled])") ?? host.querySelector<HTMLElement>("button:not([disabled])"))?.focus();
    });
  }

  async cancel(identity: TaskWorkspaceIdentity): Promise<void> {
    if (this.finished && this.controller.state.status === "idle") {
      const finished = this.finished;
      this.finished = null;
      this.visible = false;
      this.backgroundOnStart = false;
      this.clearExecutionTimer();
      finished({ status: "cancelled", outputs: [], truncated: false, error: "Task execution was cancelled." });
      this.options.visibilityChanged?.();
      return;
    }
    await this.controller.cancel(identity);
    this.controller.completeCancellation(identity);
  }

  beginArtifactDiscovery(identity: TaskWorkspaceIdentity, taskKey: string): TaskArtifactAttachmentTarget | null {
    if (!sameIdentity(this.identity, identity) || this.terminalState?.status !== "succeeded" ||
      !this.terminalState.review || executionTaskKey(this.terminalState.review) !== taskKey) return null;
    const target = { root: identity.root, generation: identity.generation, taskKey, presentationVersion: this.presentationVersion };
    this.artifactState = { status: "loading" };
    this.render();
    return target;
  }

  completeArtifactDiscovery(target: TaskArtifactAttachmentTarget, discovery: TaskArtifactDiscovery): boolean {
    if (!this.matchesArtifactTarget(target) || discovery.workspaceRoot !== target.root) return false;
    this.artifactState = { status: "ready", discovery };
    this.render();
    return true;
  }

  failArtifactDiscovery(target: TaskArtifactAttachmentTarget): boolean {
    if (!this.matchesArtifactTarget(target)) return false;
    this.artifactState = { status: "unavailable" };
    this.render();
    return true;
  }

  isArtifactTargetCurrent(target: TaskArtifactAttachmentTarget): boolean {
    return this.matchesArtifactTarget(target);
  }

  restoreFocus(fallback?: HTMLElement | null): void {
    const target = this.focusReturn;
    this.focusReturn = null;
    queueMicrotask(() => {
      if (target?.isConnected) target.focus();
      else fallback?.focus();
    });
  }

  dispose(): void {
    if (this.finished) {
      const finished = this.finished;
      this.finished = null;
      finished({ status: "cancelled", outputs: [], truncated: false, error: "Task execution was disposed." });
    }
    this.visible = false;
    this.backgroundOnStart = false;
    this.clearExecutionTimer();
    this.terminalState = null;
    this.invalidateArtifacts();
    this.listeners.abort();
    this.unsubscribe();
    this.controller.dispose();
    this.host()?.replaceChildren();
    this.restoreFocus();
  }

  private open(): void {
    if (!this.visible) {
      this.focusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.visible = true;
      this.options.visibilityChanged?.();
    }
  }

  private dismiss(): void {
    const identity = this.identity;
    if (!identity || !isTerminal(this.displayState())) return;
    this.visible = false;
    this.backgroundOnStart = false;
    this.clearExecutionTimer();
    this.invalidateArtifacts();
    this.controller.dismiss(identity);
    this.options.visibilityChanged?.();
    const fallback = this.root.querySelector<HTMLElement>("[data-tasks-action=refresh]");
    this.restoreFocus(fallback);
  }

  private retry(): void {
    const identity = this.identity;
    const review = this.terminalState?.review;
    if (!identity || !review) return;
    const taskKey = executionTaskKey(review);
    this.dismiss();
    queueMicrotask(() => this.options.retry?.(identity, taskKey));
  }

  private revealArtifact(indexValue: string | undefined): void {
    const identity = this.identity;
    if (!indexValue || !/^\d+$/u.test(indexValue)) return;
    const index = Number(indexValue);
    const artifact = this.artifactState?.status === "ready" && Number.isSafeInteger(index)
      ? this.artifactState.discovery.artifacts[index]
      : undefined;
    if (!identity || !artifact || !this.visible || this.terminalState?.status !== "succeeded") return;
    void Promise.resolve(this.options.revealArtifact?.(identity, artifact)).catch((error) => this.options.reportError?.(error));
  }

  private fail(error: unknown): void {
    const identity = this.identity;
    if (!identity) return;
    const localized = error instanceof Error && error.message.includes("already running for this workspace")
      ? new Error(this.copy().busy)
      : error;
    try { this.controller.fail(identity, localized); }
    catch { /* a stale failure cannot replace the current workspace */ }
  }

  private observeTerminal(state: TaskExecutionState): void {
    if (!this.finished) return;
    if (state.status === "idle") {
      const finished = this.finished;
      this.finished = null;
      this.visible = false;
      this.backgroundOnStart = false;
      this.clearExecutionTimer();
      finished({ status: "cancelled", outputs: [], truncated: false, error: "Task execution was cancelled." });
      this.options.visibilityChanged?.();
      const fallback = this.root.querySelector<HTMLElement>("[data-tasks-action=refresh]");
      this.restoreFocus(fallback);
      return;
    }
    if (!isTerminal(state)) return;
    this.clearExecutionTimer();
    this.backgroundOnStart = false;
    this.terminalState = state;
    const finished = this.finished;
    this.finished = null;
    finished({
      status: state.status,
      outputs: state.outputs,
      truncated: state.outputTruncated,
      error: state.error,
    });
  }

  private projectTaskTerminal(state: TaskExecutionState): void {
    const terminal = this.options.taskTerminal;
    const review = state.review;
    if (this.executionPresentation !== "terminal" || !terminal || !review) return;
    const sessionId = review.reviewId;
    try {
      if (this.projectedTerminalSessionId !== sessionId) {
        if (state.status === "review") return;
        const identity = this.identity;
        if (!identity) return;
        this.projectedTerminalSessionId = sessionId;
        this.projectedTerminalOutputCount = 0;
        terminal.begin({
          sessionId,
          workspaceRoot: identity.root,
          taskKey: executionTaskKey(review),
          label: review.label,
          executablePath: review.canonicalExecutablePath,
          args: [...review.args],
          workingDirectory: review.cwd,
          cancel: () => this.cancel(identity),
        });
      }
      for (const output of state.outputs.slice(this.projectedTerminalOutputCount)) {
        terminal.append(sessionId, output);
      }
      this.projectedTerminalOutputCount = state.outputs.length;
      if (state.status !== "idle" && state.status !== "review") {
        terminal.update(sessionId, state.status as TaskTerminalSessionStatus, state.error, state.outputTruncated);
      }
    } catch (error) {
      this.options.reportError?.(error);
    }
  }

  private resetTaskTerminalProjection(): void {
    this.projectedTerminalSessionId = null;
    this.projectedTerminalOutputCount = 0;
  }

  private displayState(): TaskExecutionState | null {
    return this.controller.state.review ? this.controller.state : this.terminalState;
  }

  private backgroundStartedExecution(state: TaskExecutionState): void {
    if (!this.backgroundOnStart || state.status !== "starting") return;
    this.startExecutionTimer();
    if (!this.visible) return;
    this.visible = false;
    this.options.visibilityChanged?.();
    const fallback = this.root.querySelector<HTMLElement>('[data-tasks-action="cancel"], [data-tasks-action="refresh"]');
    this.restoreFocus(fallback);
  }

  private startExecutionTimer(): void {
    this.clearExecutionTimer();
    const timeout = this.executionTimeoutMs;
    if (!timeout || timeout <= 0) return;
    this.executionTimer = globalThis.setTimeout(() => {
      this.executionTimer = null;
      const identity = this.identity;
      if (!identity || !this.finished) return;
      try { this.controller.fail(identity, new Error(this.copy().timedOut)); }
      catch { /* a stale timeout cannot replace the current workspace */ }
    }, timeout);
  }

  private clearExecutionTimer(): void {
    if (this.executionTimer !== null) globalThis.clearTimeout(this.executionTimer);
    this.executionTimer = null;
  }

  private matchesArtifactTarget(target: TaskArtifactAttachmentTarget): boolean {
    return taskArtifactAttachmentMatches(target, {
      identity: this.identity,
      taskKey: this.terminalState?.review ? executionTaskKey(this.terminalState.review) : null,
      presentationVersion: this.presentationVersion,
      visible: this.visible,
      succeeded: this.terminalState?.status === "succeeded",
    });
  }

  private invalidateArtifacts(): void {
    this.presentationVersion += 1;
    this.artifactState = null;
  }

  private host(): HTMLElement | null {
    return this.root.matches("#task-execution-host")
      ? this.root
      : this.root.querySelector<HTMLElement>("#task-execution-host");
  }
}

function isTerminal(state: TaskExecutionState | null): state is TaskExecutionState & { readonly status: PluginTaskExecutionResult["status"] } {
  return state !== null && (state.status === "succeeded" || state.status === "failed" || state.status === "cancelled" || state.status === "crashed");
}

function executionTaskKey(review: NonNullable<TaskExecutionState["review"]>): string {
  return `${review.pluginId}.${review.providerId}:${review.taskId}`;
}

function sameIdentity(left: TaskWorkspaceIdentity | null, right: TaskWorkspaceIdentity): boolean {
  return left?.root === right.root && left.generation === right.generation;
}

function trapFocus(host: HTMLElement, event: KeyboardEvent): void {
  const focusable = Array.from(host.querySelectorAll<HTMLElement>("button:not([disabled])"));
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
