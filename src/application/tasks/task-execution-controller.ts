import type { TaskExecutionRequest, TaskExecutionReview, TaskSessionEvent } from "../../models.ts";
import type { TaskExecutionBridge } from "../../protocol/task-execution.ts";

export type TaskExecutionStatus = "idle" | "review" | "starting" | "queued" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled" | "crashed";
export type TaskConfirmationMemory = "unsupported" | "available" | "remembered";
export interface TaskWorkspaceIdentity { readonly root: string; readonly generation: number; }
export interface TaskExecutionOutput { readonly stream: "stdout" | "stderr"; readonly dataBase64: string; }
export interface TaskExecutionState {
  readonly status: TaskExecutionStatus;
  readonly identity: TaskWorkspaceIdentity | null;
  readonly review: TaskExecutionReview | null;
  readonly confirmationMemory: TaskConfirmationMemory;
  readonly runId: string | null;
  readonly outputs: readonly TaskExecutionOutput[];
  readonly outputBytes: number;
  readonly outputTruncated: boolean;
  readonly error: string | null;
  readonly lastSequence: number;
}
type Listener = (state: TaskExecutionState) => void;
const MAX_OUTPUT_BYTES = 2 * 1_048_576;

export class TaskExecutionController {
  private value: TaskExecutionState = emptyState();
  private readonly listeners = new Set<Listener>();
  private unsubscribe: (() => void) | null = null;
  private cancelRequestedRunId: string | null = null;
  private prepareRequest = 0;
  private disposed = false;

  private readonly bridge: TaskExecutionBridge;
  constructor(bridge: TaskExecutionBridge) { this.bridge = bridge; }
  get state(): TaskExecutionState { return this.value; }
  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  activateWorkspace(identity: TaskWorkspaceIdentity): void {
    if (sameIdentity(this.value.identity, identity)) return;
    const previousRunId = this.value.runId;
    this.prepareRequest += 1;
    if (previousRunId && ["queued", "running", "cancelling"].includes(this.value.status)) void this.cancelRunOnce(previousRunId, true);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.value = { ...emptyState(), identity };
    this.emit();
  }

  clear(): void {
    this.prepareRequest += 1;
    const runId = this.value.runId;
    if (runId && ["queued", "running", "cancelling"].includes(this.value.status)) void this.cancelRunOnce(runId, true);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.value = emptyState();
    this.emit();
  }

  async prepare(
    identity: TaskWorkspaceIdentity,
    request: TaskExecutionRequest,
    allowConfirmationMemory = false,
  ): Promise<TaskExecutionReview> {
    this.requireCurrent(identity);
    const prepareRequest = ++this.prepareRequest;
    const review = await this.bridge.prepareTaskExecution(identity.root, request);
    this.requireCurrent(identity);
    if (prepareRequest !== this.prepareRequest) throw new Error("Task review request is stale.");
    if (review.workspaceRoot !== identity.root) throw new Error("Task review belongs to another workspace.");
    let confirmationMemory: TaskConfirmationMemory = allowConfirmationMemory ? "available" : "unsupported";
    if (allowConfirmationMemory && this.bridge.readTaskConfirmation) {
      const confirmation = await this.bridge.readTaskConfirmation(identity.root, review.reviewId);
      this.requireCurrent(identity);
      if (prepareRequest !== this.prepareRequest || confirmation.reviewId !== review.reviewId) {
        throw new Error("Task confirmation response is stale.");
      }
      confirmationMemory = confirmation.remembered ? "remembered" : "available";
    }
    this.value = { ...emptyState(identity), status: "review", identity, review, confirmationMemory };
    this.emit();
    return review;
  }

  async readWorkspaceTrust(identity: TaskWorkspaceIdentity, pluginId: string): Promise<"unknown" | "trusted" | "denied"> {
    this.requireCurrent(identity);
    const result = await this.bridge.readWorkspaceTrust(identity.root, pluginId);
    this.requireCurrent(identity);
    if (result.workspaceRoot !== identity.root || result.pluginId !== pluginId) throw new Error("Workspace trust belongs to another plugin workspace.");
    return result.state;
  }

  async setWorkspaceTrust(
    identity: TaskWorkspaceIdentity,
    state: "unknown" | "trusted" | "denied",
    pluginId = this.value.review?.pluginId,
  ): Promise<void> {
    this.requireCurrent(identity);
    if (!pluginId) throw new Error("Plugin workspace trust requires a plugin ID.");
    const result = await this.bridge.setWorkspaceTrust(identity.root, pluginId, state);
    this.requireCurrent(identity);
    if (result.workspaceRoot !== identity.root || result.pluginId !== pluginId || result.state !== state) throw new Error("Workspace trust response is stale.");
    if (this.value.review && this.value.status === "review") {
      this.value = { ...this.value, review: { ...this.value.review, trust: result.state } };
    } else {
      this.value = { ...emptyState(identity), identity };
    }
    this.emit();
  }

  async confirm(identity: TaskWorkspaceIdentity, rememberConfirmation = false): Promise<string> {
    this.requireCurrent(identity);
    const review = this.value.review;
    if (this.value.status !== "review" || !review) throw new Error("A task review is required before confirmation.");
    if (review.workspaceRoot !== identity.root || review.trust !== "trusted") throw new Error("A trusted current workspace is required before task execution.");
    const pending: TaskSessionEvent[] = [];
    let pendingStreamError: unknown = null;
    let startedRunId: string | null = null;
    this.value = { ...this.value, status: "starting", error: null };
    this.emit();
    this.unsubscribe?.();
    this.unsubscribe = await this.bridge.subscribeTaskSession((event) => {
      if (startedRunId) this.acceptEvent(identity, event);
      else pending.push(event);
    }, (error) => {
      if (startedRunId) this.fail(identity, streamError(error));
      else pendingStreamError ??= error;
    });
    let started;
    try {
      started = await this.bridge.startTaskExecution(
        identity.root,
        review.reviewId,
        rememberConfirmation && this.value.confirmationMemory !== "unsupported",
      );
    } catch (error) {
      this.unsubscribe?.(); this.unsubscribe = null;
      throw error;
    }
    if (this.disposed || !sameIdentity(this.value.identity, identity) || this.value.status !== "starting" || this.value.review?.reviewId !== review.reviewId || started.workspaceRoot !== identity.root || started.reviewId !== review.reviewId) {
      this.unsubscribe?.(); this.unsubscribe = null;
      await this.cancelRunOnce(started.runId, true);
      throw new Error("Task execution start is stale.");
    }
    this.value = { ...this.value, status: "queued", runId: started.runId, lastSequence: 0, error: null };
    this.cancelRequestedRunId = null;
    this.emit();
    startedRunId = started.runId;
    if (pendingStreamError) {
      this.fail(identity, streamError(pendingStreamError));
      return started.runId;
    }
    for (const event of pending) this.acceptEvent(identity, event);
    return started.runId;
  }

  async cancel(identity: TaskWorkspaceIdentity): Promise<void> {
    if (!sameIdentity(this.value.identity, identity)) return;
    if (this.value.status === "review" || this.value.status === "starting") {
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.value = { ...emptyState(identity), identity };
      this.emit();
      return;
    }
    const runId = this.value.runId;
    if (!runId || ["succeeded", "failed", "cancelled", "crashed", "idle", "review"].includes(this.value.status)) return;
    if (this.value.status === "cancelling") return;
    const previousStatus = this.value.status;
    this.value = { ...this.value, status: "cancelling", error: null };
    this.emit();
    try {
      await this.cancelRunOnce(runId, false);
    } catch (error) {
      if (this.value.runId === runId && this.value.status === "cancelling") {
        this.value = { ...this.value, status: previousStatus };
        this.emit();
      }
      throw error;
    }
  }

  completeCancellation(identity: TaskWorkspaceIdentity): boolean {
    this.requireCurrent(identity);
    if (this.value.status !== "cancelling") return false;
    this.cancelRequestedRunId = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.value = { ...this.value, status: "cancelled", error: null };
    this.emit();
    return true;
  }

  fail(identity: TaskWorkspaceIdentity, error: unknown): void {
    this.requireCurrent(identity);
    if (["succeeded", "failed", "cancelled", "crashed"].includes(this.value.status)) return;
    const runId = this.value.runId;
    this.cancelRequestedRunId = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.value = {
      ...this.value,
      status: "crashed",
      error: error instanceof Error ? error.message : String(error),
    };
    this.emit();
    if (runId) void this.cancelRunOnce(runId, true);
  }

  dismiss(identity: TaskWorkspaceIdentity): void {
    this.requireCurrent(identity);
    if (this.value.status === "starting" || this.value.status === "queued" || this.value.status === "running" || this.value.status === "cancelling") {
      throw new Error("An active task must be cancelled before its output can be closed.");
    }
    this.prepareRequest += 1;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.value = emptyState(identity);
    this.emit();
  }

  dispose(): void {
    const runId = this.value.runId;
    if (runId && ["queued", "running", "cancelling"].includes(this.value.status)) void this.cancelRunOnce(runId, true);
    this.disposed = true;
    this.prepareRequest += 1;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.listeners.clear();
  }

  private acceptEvent(identity: TaskWorkspaceIdentity, event: TaskSessionEvent): void {
    if (this.disposed || !sameIdentity(this.value.identity, identity) || event.workspaceRoot !== identity.root || this.value.runId !== event.runId || event.sequence <= this.value.lastSequence) return;
    if (event.sequence !== this.value.lastSequence + 1) {
      this.value = { ...this.value, status: "crashed", error: "Task session event sequence is discontinuous.", lastSequence: event.sequence };
      this.emit();
      void this.cancelRunOnce(event.runId, true);
      this.unsubscribe?.(); this.unsubscribe = null;
      return;
    }
    if (["succeeded", "failed", "cancelled", "crashed"].includes(this.value.status)) return;
    let next: TaskExecutionState = { ...this.value, lastSequence: event.sequence };
    if (event.kind === "output") {
      const bytes = estimateBase64Bytes(event.dataBase64);
      if (next.outputBytes + bytes <= MAX_OUTPUT_BYTES) next = { ...next, outputs: [...next.outputs, { stream: event.stream, dataBase64: event.dataBase64 }], outputBytes: next.outputBytes + bytes };
      else next = { ...next, outputTruncated: true };
    } else if (event.kind === "truncated") next = { ...next, outputTruncated: true };
    else {
      const status = next.status === "cancelling" && event.status === "running" ? "cancelling" : event.status;
      next = { ...next, status, error: event.status === "failed" || event.status === "crashed" ? event.message : null };
    }
    this.value = next;
    this.emit();
    if (["succeeded", "failed", "cancelled", "crashed"].includes(next.status)) {
      this.cancelRequestedRunId = null;
      this.unsubscribe?.(); this.unsubscribe = null;
    }
  }

  private async cancelRunOnce(runId: string, bestEffort: boolean): Promise<void> {
    if (this.cancelRequestedRunId === runId) return;
    this.cancelRequestedRunId = runId;
    try {
      await this.bridge.cancelTaskExecution(runId);
    } catch (error) {
      if (this.cancelRequestedRunId === runId) this.cancelRequestedRunId = null;
      if (!bestEffort) throw error;
    }
  }

  private requireCurrent(identity: TaskWorkspaceIdentity): void { if (this.disposed || !sameIdentity(this.value.identity, identity)) throw new Error("Task operation belongs to a stale workspace."); }
  private emit(): void { for (const listener of this.listeners) listener(this.value); }
}

function emptyState(identity: TaskWorkspaceIdentity | null = null): TaskExecutionState { return { status: "idle", identity, review: null, confirmationMemory: "unsupported", runId: null, outputs: [], outputBytes: 0, outputTruncated: false, error: null, lastSequence: 0 }; }
function sameIdentity(left: TaskWorkspaceIdentity | null, right: TaskWorkspaceIdentity | null): boolean { return left?.root === right?.root && left?.generation === right?.generation; }
function estimateBase64Bytes(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor(value.length * 3 / 4) - padding;
}
function streamError(error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`Task session event could not be decoded: ${detail}`);
}
