import type {
  BundledPlugin,
  PluginActivationContext,
  PluginMatchContext,
  PluginWorkspaceCatalogEvidence,
  PluginTaskExecutionResult,
  PluginTaskRefreshPlan,
} from "../../application/plugins/index.ts";
import {
  ANDROID_GRADLE_DETECTOR_LIMITS,
  detectAndroidGradleEvidence,
  type AndroidGradleEvidenceSnapshot,
} from "./detector.ts";
import {
  ANDROID_GRADLE_DISCOVERY_LIMITS,
  buildGradleWrapperRequest,
  parseGradleTasksOutput,
  type GradleTaskDiscoveryResult,
} from "./discovery.ts";
import { applyGradleTaskResult, buildGradleTaskRunPlan, runnableGradleSnapshot, setGradleTaskRunState } from "./execution.ts";
import { deriveGradleQuickActions, gradleTaskArtifactHints } from "./quick-actions.ts";

export const ANDROID_GRADLE_PLUGIN_ID = "dev.asterlyn.android-gradle";

/**
 * First-party Android/Gradle integration descriptor.
 *
 * Activation starts no process. Explicit refresh returns a typed discovery plan;
 * only the host can review, authorize, execute, cancel, and return its bounded result.
 */
export const ANDROID_GRADLE_PLUGIN: BundledPlugin = Object.freeze({
  id: ANDROID_GRADLE_PLUGIN_ID,
  version: "0.1.0",
  matches: (context: PluginMatchContext) => detectAndroidGradlePluginEvidence(context)?.android === true,
  evidenceKey: (context: PluginMatchContext) => {
    const evidence = detectAndroidGradlePluginEvidence(context);
    return evidence ? JSON.stringify([
      evidence.platform,
      evidence.bounded,
      evidence.catalogTruncated,
      evidence.gradle,
      evidence.android,
      evidence.wrapper,
      evidence.evidence,
    ]) : "unsupported";
  },
  activate: (context: PluginActivationContext) => {
    const detection = detectAndroidGradlePluginEvidence(context);
    if (!detection?.android) return;
    let snapshot: GradleTaskDiscoveryResult = {
      status: "unavailable",
      tasks: [],
      unavailableReason: detection.catalogTruncated ? "evidence-incomplete" : "discovery-not-supported",
    };
    context.contribute({
      kind: "provider",
      id: "gradle-tasks",
      label: "Gradle",
      snapshot: () => snapshot,
      refresh: () => {
        const retainedTasks = snapshot.tasks;
        const prepared = buildGradleWrapperRequest(detection);
        if (!prepared.supported) {
          snapshot = { status: "unavailable", tasks: [], unavailableReason: prepared.reason === "wrapper-missing" ? "discovery-not-supported" : "evidence-incomplete" };
          return null;
        }
        const plan: PluginTaskRefreshPlan = {
          request: prepared.request,
          apply: (result: PluginTaskExecutionResult) => {
            if (result.status !== "succeeded") {
              snapshot = { status: "error", tasks: retainedTasks, error: result.error ?? (result.status === "cancelled" ? "Gradle task discovery was cancelled." : `Gradle task discovery ${result.status}.`) };
              return;
            }
            if (result.truncated) {
              snapshot = { status: "error", tasks: retainedTasks, error: "Gradle task discovery output was truncated." };
              return;
            }
            const chunks: Uint8Array[] = [];
            let byteLength = 0;
            for (const output of result.outputs) {
              if (output.stream !== "stdout") continue;
              try {
                const binary = atob(output.dataBase64);
                byteLength += binary.length;
                if (byteLength > ANDROID_GRADLE_DISCOVERY_LIMITS.maxOutputBytes) {
                  snapshot = { status: "error", tasks: retainedTasks, error: "Gradle task discovery output exceeded the discovery limit." };
                  return;
                }
                chunks.push(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
              } catch {
                snapshot = { status: "error", tasks: retainedTasks, error: "Gradle task discovery output was invalid." };
                return;
              }
            }
            const bytes = new Uint8Array(byteLength);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            const parsed = parseGradleTasksOutput(bytes);
            snapshot = parsed.status === "ready"
              ? withGradleQuickActions(runnableGradleSnapshot(parsed))
              : { ...parsed, tasks: retainedTasks };
          },
        };
        snapshot = { status: "loading", tasks: retainedTasks };
        return plan;
      },
      run: (taskId: string) => {
        const plan = buildGradleTaskRunPlan(detection, snapshot, taskId);
        if (!plan) return null;
        snapshot = setGradleTaskRunState(snapshot, taskId, "queued");
        const artifactHints = gradleTaskArtifactHints(taskId);
        return {
          request: plan,
          ...(artifactHints.length > 0 ? { artifactSearch: { hints: artifactHints } } : {}),
          apply: (result: PluginTaskExecutionResult) => {
            snapshot = applyGradleTaskResult(snapshot, taskId, result);
          },
        };
      },
    });
    context.contribute({
      kind: "command", id: "refresh-gradle-tasks", providerId: "gradle-tasks", title: () => "Gradle", detail: () => "Gradle", execute: () => undefined,
    });
  },
});

function withGradleQuickActions(snapshot: GradleTaskDiscoveryResult): GradleTaskDiscoveryResult {
  if (snapshot.status !== "ready") return snapshot;
  const quickActions = new Map(deriveGradleQuickActions(snapshot).actions.map((action) => [action.taskId, action]));
  return {
    ...snapshot,
    tasks: snapshot.tasks.map((task) => {
      const quick = quickActions.get(task.id);
      return quick ? { ...task, androidQuickAction: { kind: quick.kind, module: quick.module, variant: quick.variant } } : task;
    }),
  };
}

export function detectAndroidGradlePluginEvidence(
  context: PluginMatchContext,
): AndroidGradleEvidenceSnapshot | null {
  if (!isWorkspaceCatalogEvidence(context.evidence)) return null;
  return detectAndroidGradleEvidence({
    workspaceRoot: context.identity.root,
    generation: context.identity.generation,
    platform: context.evidence.platform,
    files: context.evidence.files,
    catalogTruncated: context.evidence.truncated,
  });
}

function isWorkspaceCatalogEvidence(
  evidence: { readonly [key: string]: unknown },
): evidence is PluginWorkspaceCatalogEvidence {
  if (evidence.kind !== "workspace-catalog" ||
    (evidence.platform !== "posix" && evidence.platform !== "windows") ||
    typeof evidence.truncated !== "boolean" || !Array.isArray(evidence.files)) return false;
  if (evidence.files.length > ANDROID_GRADLE_DETECTOR_LIMITS.maxPaths) return true;
  return evidence.files.every((file) => typeof file === "object" && file !== null &&
    typeof (file as { readonly workspacePath?: unknown }).workspacePath === "string");
}
