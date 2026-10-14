import type { TaskExecutionRequest, TaskExecutionReview, TaskExecutionStarted, TaskSessionEvent, WorkspaceTrustResult, WorkspaceTrustState } from "../../models.ts";
import type { TaskExecutionBridge } from "../../protocol/task-execution.ts";

const trustByRoot = new Map<string, WorkspaceTrustState>();
const listeners = new Set<(event: TaskSessionEvent) => void>();

/** Browser demo boundary: it can render reviews, but never launches workspace commands. */
export const demoTaskExecutionBridge: TaskExecutionBridge = {
  native: false,
  async readWorkspaceTrust(workspaceRoot): Promise<WorkspaceTrustResult> {
    return { protocolVersion: 1, workspaceRoot, state: trustByRoot.get(workspaceRoot) ?? "unknown" };
  },
  async setWorkspaceTrust(workspaceRoot, state): Promise<WorkspaceTrustResult> {
    trustByRoot.set(workspaceRoot, state);
    return { protocolVersion: 1, workspaceRoot, state };
  },
  async prepareTaskExecution(workspaceRoot, request: TaskExecutionRequest): Promise<TaskExecutionReview> {
    return { protocolVersion: 1, reviewId: `demo-review-${Date.now()}`, workspaceRoot, ...request, canonicalExecutablePath: `${workspaceRoot}/${request.executablePath}`, cwd: workspaceRoot, trust: trustByRoot.get(workspaceRoot) ?? "unknown" };
  },
  async startTaskExecution(): Promise<TaskExecutionStarted> {
    throw new Error("The browser demo does not execute workspace tasks.");
  },
  async cancelTaskExecution(): Promise<void> {
    // There is no demo process to cancel.
  },
  async subscribeTaskSession(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
