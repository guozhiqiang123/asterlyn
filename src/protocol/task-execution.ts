import type {
  TaskExecutionRequest,
  TaskExecutionReview,
  TaskExecutionStarted,
  TaskSessionEvent,
  WorkspaceTrustResult,
  WorkspaceTrustState,
} from "../models.ts";

export const TASK_SESSION_EVENT = "task-session-event";
const MAX_TEXT = 16_384;
const MAX_ARG = 16_384;
const MAX_ARGS = 128;

export interface TaskExecutionBridge {
  readonly native: boolean;
  readWorkspaceTrust(workspaceRoot: string): Promise<WorkspaceTrustResult>;
  setWorkspaceTrust(workspaceRoot: string, state: WorkspaceTrustState): Promise<WorkspaceTrustResult>;
  prepareTaskExecution(workspaceRoot: string, request: TaskExecutionRequest): Promise<TaskExecutionReview>;
  startTaskExecution(workspaceRoot: string, reviewId: string): Promise<TaskExecutionStarted>;
  cancelTaskExecution(runId: string): Promise<void>;
  subscribeTaskSession(listener: (event: TaskSessionEvent) => void): Promise<() => void>;
}

export function parseWorkspaceTrust(value: unknown): WorkspaceTrustResult {
  const record = object(value, "Workspace trust response");
  protocol(record, "Workspace trust response");
  const workspaceRoot = text(record.workspaceRoot, "workspaceRoot", MAX_TEXT);
  const state = trust(record.state);
  return { protocolVersion: 1, workspaceRoot, state };
}

export function parseTaskExecutionReview(value: unknown): TaskExecutionReview {
  const record = object(value, "Task execution review");
  protocol(record, "Task execution review");
  const result: TaskExecutionReview = {
    protocolVersion: 1,
    reviewId: text(record.reviewId, "reviewId", MAX_TEXT),
    workspaceRoot: text(record.workspaceRoot, "workspaceRoot", MAX_TEXT),
    pluginId: text(record.pluginId, "pluginId", MAX_TEXT),
    providerId: text(record.providerId, "providerId", MAX_TEXT),
    taskId: text(record.taskId, "taskId", MAX_TEXT),
    label: text(record.label, "label", MAX_TEXT),
    executablePath: text(record.executablePath, "executablePath", MAX_TEXT),
    canonicalExecutablePath: text(record.canonicalExecutablePath, "canonicalExecutablePath", MAX_TEXT),
    args: args(record.args),
    cwd: text(record.cwd, "cwd", MAX_TEXT),
    trust: trust(record.trust),
  };
  return result;
}

export function parseTaskExecutionStarted(value: unknown): TaskExecutionStarted {
  const record = object(value, "Task execution start response");
  protocol(record, "Task execution start response");
  return {
    protocolVersion: 1,
    runId: text(record.runId, "runId", MAX_TEXT),
    reviewId: text(record.reviewId, "reviewId", MAX_TEXT),
    workspaceRoot: text(record.workspaceRoot, "workspaceRoot", MAX_TEXT),
  };
}

export function parseTaskSessionEvent(value: unknown): TaskSessionEvent {
  const record = object(value, "Task session event");
  protocol(record, "Task session event");
  const runId = text(record.runId, "runId", MAX_TEXT);
  const workspaceRoot = text(record.workspaceRoot, "workspaceRoot", MAX_TEXT);
  if (record.kind === "output") {
    const stream = record.stream === "stdout" || record.stream === "stderr" ? record.stream : invalid("stream");
    const dataBase64 = text(record.dataBase64, "dataBase64", 1_398_104);
    if (!isBase64(dataBase64) || Math.floor(dataBase64.length * 3 / 4) > 1_048_576) throw new Error("Task dataBase64 is invalid or too large.");
    return { protocolVersion: 1, kind: "output", runId, workspaceRoot, sequence: sequence(record.sequence), stream, dataBase64 };
  }
  if (record.kind === "truncated") {
    const stream = record.stream === "stdout" || record.stream === "stderr" ? record.stream : invalid("stream");
    if (!Number.isSafeInteger(record.omittedBytes) || (record.omittedBytes as number) < 1) throw new Error("Task truncation has invalid omittedBytes.");
    return { protocolVersion: 1, kind: "truncated", runId, workspaceRoot, sequence: sequence(record.sequence), stream, omittedBytes: record.omittedBytes as number };
  }
  if (record.kind === "status") {
    const statuses = ["queued", "running", "succeeded", "failed", "cancelled", "crashed"] as const;
    if (!statuses.includes(record.status as typeof statuses[number])) throw new Error("Task status is invalid.");
    const message = record.message === null ? null : text(record.message, "message", MAX_TEXT);
    const exitCode = record.exitCode === null ? null : integer(record.exitCode, "exitCode");
    return { protocolVersion: 1, kind: "status", runId, workspaceRoot, sequence: sequence(record.sequence), status: record.status as typeof statuses[number], message, exitCode };
  }
  throw new Error("Task session event kind is invalid.");
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function protocol(record: Record<string, unknown>, label: string): void { if (record.protocolVersion !== 1) throw new Error(`${label} has unsupported protocol version.`); }
function text(value: unknown, field: string, limit: number): string { if (typeof value !== "string" || !value || value.length > limit || value.includes("\0")) throw new Error(`Task ${field} is invalid.`); return value; }
function args(value: unknown): string[] { if (!Array.isArray(value) || value.length > MAX_ARGS || !value.every((item) => typeof item === "string" && item.length <= MAX_ARG && !item.includes("\0"))) throw new Error("Task args are invalid."); return [...value]; }
function trust(value: unknown): WorkspaceTrustState { if (value !== "unknown" && value !== "trusted" && value !== "denied") throw new Error("Workspace trust state is invalid."); return value; }
function sequence(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error("Task sequence is invalid."); return value as number; }
function integer(value: unknown, field: string): number { if (!Number.isSafeInteger(value)) throw new Error(`Task ${field} is invalid.`); return value as number; }
function invalid(field: string): never { throw new Error(`Task ${field} is invalid.`); }
function isBase64(value: string): boolean { return value.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value); }
