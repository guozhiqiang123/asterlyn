import type { AndroidGradleEvidenceSnapshot } from "./detector.ts";
import type { TaskExecutionRequest, PluginTaskExecutionResult } from "./sdk-compat.ts";
import {
  ANDROID_GRADLE_EXECUTION_FLAGS,
  type GradleTaskDescriptor,
  type GradleTaskDiscoveryResult,
  buildGradleWrapperRequest,
} from "./discovery.ts";

export type GradleTaskRunState = "idle" | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "crashed";
export type GradleTaskExecutionDescriptor = GradleTaskDescriptor & { readonly runState: GradleTaskRunState };

export function runnableGradleSnapshot(snapshot: GradleTaskDiscoveryResult): GradleTaskDiscoveryResult {
  if (snapshot.status !== "ready") return snapshot;
  return { ...snapshot, tasks: snapshot.tasks.map((task) => ({ ...task, runnable: true, disabledReason: undefined, runState: "idle" as const })) as readonly GradleTaskExecutionDescriptor[] };
}

export function buildGradleTaskRunPlan(
  evidence: AndroidGradleEvidenceSnapshot,
  snapshot: GradleTaskDiscoveryResult,
  taskId: string,
): TaskExecutionRequest | null {
  if (snapshot.status !== "ready" || !taskId || taskId.includes("\0")) return null;
  const task = snapshot.tasks.find((candidate) => candidate.id === taskId && candidate.runnable);
  const wrapper = buildGradleWrapperRequest(evidence);
  if (!task || !wrapper.supported) return null;
  return {
    pluginId: wrapper.request.pluginId,
    providerId: wrapper.request.providerId,
    taskId: task.id,
    label: task.label,
    executablePath: wrapper.request.executablePath,
    args: [task.id, ...ANDROID_GRADLE_EXECUTION_FLAGS],
  };
}

export function applyGradleTaskResult(
  snapshot: GradleTaskDiscoveryResult,
  taskId: string,
  result: PluginTaskExecutionResult,
): GradleTaskDiscoveryResult {
  if (snapshot.status !== "ready") return snapshot;
  return {
    ...snapshot,
    tasks: snapshot.tasks.map((task) => task.id === taskId ? {
      ...task,
      runnable: true,
      disabledReason: undefined,
      runState: result.status,
    } : task) as readonly GradleTaskExecutionDescriptor[],
  };
}

export function setGradleTaskRunState(snapshot: GradleTaskDiscoveryResult, taskId: string, runState: GradleTaskRunState): GradleTaskDiscoveryResult {
  if (snapshot.status !== "ready") return snapshot;
  return {
    ...snapshot,
    tasks: snapshot.tasks.map((task) => ({
      ...task,
      runnable: true,
      disabledReason: undefined,
      runState: task.id === taskId ? runState : "idle",
    })) as readonly GradleTaskExecutionDescriptor[],
  };
}
