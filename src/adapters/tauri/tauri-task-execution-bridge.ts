import type {
  TaskExecutionRequest,
  TaskExecutionReview,
  TaskExecutionStarted,
  TaskSessionEvent,
  WorkspaceTrustResult,
  WorkspaceTrustState,
} from "../../models.ts";
import { parseTaskExecutionReview, parseTaskExecutionStarted, parseTaskSessionEvent, parseWorkspaceTrust, TASK_SESSION_EVENT, type TaskExecutionBridge } from "../../protocol/task-execution.ts";
import { invokeDesktopCommand } from "./desktop-command-adapter.ts";

export const tauriTaskExecutionBridge: TaskExecutionBridge = {
  native: true,
  readWorkspaceTrust: async (workspaceRoot): Promise<WorkspaceTrustResult> => parseWorkspaceTrust(await invokeDesktopCommand("read_workspace_trust", { workspaceRoot })),
  setWorkspaceTrust: async (workspaceRoot, state: WorkspaceTrustState): Promise<WorkspaceTrustResult> => parseWorkspaceTrust(await invokeDesktopCommand("set_workspace_trust", { workspaceRoot, state })),
  prepareTaskExecution: async (workspaceRoot, request: TaskExecutionRequest): Promise<TaskExecutionReview> => parseTaskExecutionReview(await invokeDesktopCommand("prepare_task_execution", { workspaceRoot, request })),
  startTaskExecution: async (workspaceRoot, reviewId): Promise<TaskExecutionStarted> => parseTaskExecutionStarted(await invokeDesktopCommand("start_task_execution", { workspaceRoot, reviewId })),
  cancelTaskExecution: (runId) => invokeDesktopCommand("cancel_task_execution", { runId }),
  async subscribeTaskSession(listener: (event: TaskSessionEvent) => void): Promise<() => void> {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<unknown>(TASK_SESSION_EVENT, (event) => listener(parseTaskSessionEvent(event.payload)));
  },
};
