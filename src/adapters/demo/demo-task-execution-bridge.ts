import type { TaskExecutionRequest, TaskExecutionReview, TaskExecutionStarted, TaskSessionEvent, WorkspaceTrustResult, WorkspaceTrustState } from "../../models.ts";
import type { TaskExecutionBridge } from "../../protocol/task-execution.ts";

const trustByRoot = new Map<string, WorkspaceTrustState>();
const listeners = new Set<(event: TaskSessionEvent) => void>();

/** Browser demo boundary: it can render reviews, but never launches workspace commands. */
export const demoTaskExecutionBridge: TaskExecutionBridge = {
  native: false,
  async readWorkspaceTrust(workspaceRoot, pluginId): Promise<WorkspaceTrustResult> {
    return { protocolVersion: 1, workspaceRoot, pluginId, state: trustByRoot.get(`${workspaceRoot}\0${pluginId}`) ?? "unknown" };
  },
  async setWorkspaceTrust(workspaceRoot, pluginId, state): Promise<WorkspaceTrustResult> {
    trustByRoot.set(`${workspaceRoot}\0${pluginId}`, state);
    return { protocolVersion: 1, workspaceRoot, pluginId, state };
  },
  async prepareTaskExecution(workspaceRoot, request: TaskExecutionRequest): Promise<TaskExecutionReview> {
    return { protocolVersion: 1, reviewId: `demo-review-${Date.now()}`, workspaceRoot, ...request, canonicalExecutablePath: `${workspaceRoot}/${request.executablePath}`, cwd: workspaceRoot, trust: trustByRoot.get(`${workspaceRoot}\0${request.pluginId}`) ?? "unknown" };
  },
  async readTaskConfirmation(_workspaceRoot, reviewId) {
    return { protocolVersion: 1, reviewId, remembered: false };
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
