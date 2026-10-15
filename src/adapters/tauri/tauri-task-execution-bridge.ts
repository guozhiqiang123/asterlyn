import type {
  TaskExecutionRequest,
  TaskExecutionReview,
  TaskExecutionStarted,
  TaskSessionEvent,
  WorkspaceTrustResult,
  WorkspaceTrustState,
} from "../../models.ts";
import { parseTaskConfirmation, parseTaskExecutionReview, parseTaskExecutionStarted, parseTaskSessionEvent, parseWorkspaceTrust, TASK_SESSION_EVENT, type TaskExecutionBridge } from "../../protocol/task-execution.ts";
import { invokeDesktopCommand } from "./desktop-command-adapter.ts";

export const tauriTaskExecutionBridge: TaskExecutionBridge = {
  native: true,
  readWorkspaceTrust: async (workspaceRoot, pluginId): Promise<WorkspaceTrustResult> => parseWorkspaceTrust(await invokeDesktopCommand("read_workspace_trust", { workspaceRoot, pluginId })),
  setWorkspaceTrust: async (workspaceRoot, pluginId, state: WorkspaceTrustState): Promise<WorkspaceTrustResult> => parseWorkspaceTrust(await invokeDesktopCommand("set_workspace_trust", { workspaceRoot, pluginId, state })),
  prepareTaskExecution: async (workspaceRoot, request: TaskExecutionRequest): Promise<TaskExecutionReview> => parseTaskExecutionReview(await invokeDesktopCommand("prepare_task_execution", { workspaceRoot, request })),
  readTaskConfirmation: async (workspaceRoot, reviewId) => parseTaskConfirmation(await invokeDesktopCommand("read_task_confirmation", { workspaceRoot, reviewId })),
  startTaskExecution: async (workspaceRoot, reviewId, rememberConfirmation): Promise<TaskExecutionStarted> => parseTaskExecutionStarted(await invokeDesktopCommand("start_task_execution", { workspaceRoot, reviewId, rememberConfirmation })),
  cancelTaskExecution: (runId) => invokeDesktopCommand("cancel_task_execution", { runId }),
  async subscribeTaskSession(listener: (event: TaskSessionEvent) => void, onError?: (error: unknown) => void): Promise<() => void> {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<unknown>(TASK_SESSION_EVENT, (event) => {
      try { listener(parseTaskSessionEvent(event.payload)); }
      catch (error) { onError?.(error); }
    });
  },
};
