import type { TaskExecutionRequest, TaskExecutionReview, TaskSessionEvent } from "../../models.ts";
import type { TaskExecutionBridge } from "../../protocol/task-execution.ts";

export type TaskExecutionStatus = "idle" | "review" | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "crashed";
export interface TaskWorkspaceIdentity { readonly root: string; readonly generation: number; }
export interface TaskExecutionOutput { readonly stream: "stdout" | "stderr"; readonly dataBase64: string; }
export interface TaskExecutionState {
  readonly status: TaskExecutionStatus;
  readonly identity: TaskWorkspaceIdentity | null;
  readonly review: TaskExecutionReview | null;
  readonly runId: string | null;
  readonly outputs: readonly TaskExecutionOutput[];
  readonly outputBytes: number;
  readonly outputTruncated: boolean;
  readonly error: string | null;
  readonly lastSequence: number;
}
type Listener = (state: TaskExecutionState) => void;
const MAX_OUTPUT_BYTES = 1_048_576;

export class TaskExecutionController {
  private value: TaskExecutionState = emptyState();
  private readonly listeners = new Set<Listener>();
  private unsubscribe: (() => void) | null = null;
  private cancelRequestedRunId: string | null = null;
  private disposed = false;

  private readonly bridge: TaskExecutionBridge;
  constructor(bridge: TaskExecutionBridge) { this.bridge = bridge; }
  get state(): TaskExecutionState { return this.value; }
  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  activateWorkspace(identity: TaskWorkspaceIdentity): void {
    if (sameIdentity(this.value.identity, identity)) return;
    const previousRunId = this.value.runId;
    if (previousRunId && ["queued", "running"].includes(this.value.status)) void this.cancelRunOnce(previousRunId, true);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.value = { ...emptyState(), identity };
    this.emit();
  }

  clear(): void {
    const runId = this.value.runId;
    if (runId && ["queued", "running"].includes(this.value.status)) void this.cancelRunOnce(runId, true);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.value = emptyState();
    this.emit();
  }

  async prepare(identity: TaskWorkspaceIdentity, request: TaskExecutionRequest): Promise<TaskExecutionReview> {
    this.requireCurrent(identity);
    const review = await this.bridge.prepareTaskExecution(identity.root, request);
    this.requireCurrent(identity);
    if (review.workspaceRoot !== identity.root) throw new Error("Task review belongs to another workspace.");
    this.value = { ...emptyState(identity), status: "review", identity, review };
    this.emit();
    return review;
  }

  async readWorkspaceTrust(identity: TaskWorkspaceIdentity): Promise<"unknown" | "trusted" | "denied"> {
    this.requireCurrent(identity);
    const result = await this.bridge.readWorkspaceTrust(identity.root);
    this.requireCurrent(identity);
    if (result.workspaceRoot !== identity.root) throw new Error("Workspace trust belongs to another workspace.");
    return result.state;
  }

  async setWorkspaceTrust(identity: TaskWorkspaceIdentity, state: "unknown" | "trusted" | "denied"): Promise<void> {
    this.requireCurrent(identity);
    const result = await this.bridge.setWorkspaceTrust(identity.root, state);
    this.requireCurrent(identity);
    if (result.workspaceRoot !== identity.root || result.state !== state) throw new Error("Workspace trust response is stale.");
    if (this.value.review && this.value.status === "review") {
      this.value = { ...this.value, review: { ...this.value.review, trust: result.state } };
    } else {
      this.value = { ...emptyState(identity), identity };
    }
    this.emit();
  }

  async confirm(identity: TaskWorkspaceIdentity): Promise<string> {
    this.requireCurrent(identity);
    const review = this.value.review;
    if (this.value.status !== "review" || !review) throw new Error("A task review is required before confirmation.");
    if (review.workspaceRoot !== identity.root || review.trust !== "trusted") throw new Error("A trusted current workspace is required before task execution.");
    const pending: TaskSessionEvent[] = [];
    let startedRunId: string | null = null;
    this.unsubscribe?.();
    this.unsubscribe = await this.bridge.subscribeTaskSession((event) => {
      if (startedRunId) this.acceptEvent(identity, event);
      else pending.push(event);
    });
    let started;
    try {
      started = await this.bridge.startTaskExecution(identity.root, review.reviewId);
    } catch (error) {
      this.unsubscribe?.(); this.unsubscribe = null;
      throw error;
    }
    if (!sameIdentity(this.value.identity, identity) || started.workspaceRoot !== identity.root || started.reviewId !== review.reviewId) {
      this.unsubscribe?.(); this.unsubscribe = null;
      await this.cancelRunOnce(started.runId, true);
      throw new Error("Task execution start is stale.");
    }
    this.value = { ...this.value, status: "queued", runId: started.runId, lastSequence: 0, error: null };
    this.cancelRequestedRunId = null;
    this.emit();
    startedRunId = started.runId;
    for (const event of pending) this.acceptEvent(identity, event);
    return started.runId;
  }

  async cancel(identity: TaskWorkspaceIdentity): Promise<void> {
    if (!sameIdentity(this.value.identity, identity)) return;
    if (this.value.status === "review") {
      this.value = { ...emptyState(identity), identity };
      this.emit();
      return;
    }
    const runId = this.value.runId;
    if (!runId || ["succeeded", "failed", "cancelled", "crashed", "idle", "review"].includes(this.value.status)) return;
    await this.cancelRunOnce(runId, false);
  }

  dispose(): void {
    const runId = this.value.runId;
    if (runId && ["queued", "running"].includes(this.value.status)) void this.cancelRunOnce(runId, true);
    this.disposed = true;
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
      next = { ...next, status: event.status, error: event.status === "failed" || event.status === "crashed" ? event.message : null };
    }
    this.value = next;
    this.emit();
    if (["succeeded", "failed", "cancelled", "crashed"].includes(next.status)) {
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

function emptyState(identity: TaskWorkspaceIdentity | null = null): TaskExecutionState { return { status: "idle", identity, review: null, runId: null, outputs: [], outputBytes: 0, outputTruncated: false, error: null, lastSequence: 0 }; }
function sameIdentity(left: TaskWorkspaceIdentity | null, right: TaskWorkspaceIdentity | null): boolean { return left?.root === right?.root && left?.generation === right?.generation; }
function estimateBase64Bytes(value: string): number { return Math.floor(value.length * 3 / 4); }
