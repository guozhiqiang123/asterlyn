import type {
  SdkPluginModule,
  SdkPluginActivationContext,
  SdkPluginMatchContext,
  SdkPluginTaskCacheCapability,
  SdkWorkspaceEvidence,
} from "../../../packages/plugin-sdk/index.ts";
import {
  detectAndroidGradleEvidence,
  type AndroidGradleEvidenceSnapshot,
} from "./detector.ts";
import {
  ANDROID_GRADLE_DISCOVERY_LIMITS,
  buildGradleWrapperRequest,
  parseGradleTasksOutput,
} from "./discovery.ts";
import { applyGradleTaskResult, buildGradleTaskRunPlan, runnableGradleSnapshot, setGradleTaskRunState } from "./execution.ts";
import { deriveGradleQuickActions, gradleTaskArtifactHints } from "./quick-actions.ts";
import {
  decodeAndroidGradleCachePayload,
  encodeAndroidGradleCachePayload,
  fingerprintPaths,
  intersectsFingerprintPaths,
} from "./task-cache.ts";
import type { TaskDescriptor, GradleTaskDescriptor, GradleTaskDiscoveryResult, PluginTaskExecutionResult, PluginTaskRefreshPlan, PluginTaskRunPlan } from "./sdk-compat.ts";
import { withQuickAction } from "./sdk-compat.ts";
import type { SdkTaskProviderCacheMetadata } from "../../../packages/plugin-sdk/index.ts";

export const ANDROID_GRADLE_PLUGIN_ID = "dev.asterlyn.android-gradle";

interface AndroidProviderContribution {
  readonly kind: "provider";
  readonly id: string;
  readonly label: string;
  readonly settingsFocus: string;
  readonly snapshot: () => GradleTaskDiscoveryResult;
  readonly subscribe: (listener: () => void) => { dispose(): void };
  readonly invalidate: (invalidation: { readonly paths: readonly string[]; readonly recovery: "none" | "pathsTruncated" | "rootAmbiguous" | "backendOverflow" }) => void | Promise<void>;
  readonly refresh: () => PluginTaskRefreshPlan | null;
  readonly run: (taskId: string) => Promise<PluginTaskRunPlan | null>;
}

/**
 * First-party Android/Gradle integration descriptor.
 *
 * Activation starts no process. Explicit refresh returns a typed discovery plan;
 * only the host can review, authorize, execute, cancel, and return its bounded result.
 */
export const ANDROID_GRADLE_PLUGIN: SdkPluginModule = Object.freeze({
  sdkMajor: 1,
  id: ANDROID_GRADLE_PLUGIN_ID,
  version: "0.1.0",
  manifest: Object.freeze({
    sdkMajor: 1,
    id: ANDROID_GRADLE_PLUGIN_ID,
    version: "0.1.0",
    nameKey: "plugins.androidGradle.name",
    descriptionKey: "plugins.androidGradle.description",
    settings: Object.freeze([{
      id: "taskPresentation",
      kind: "enum",
      labelKey: "plugins.androidGradle.taskPresentation.label",
      descriptionKey: "plugins.androidGradle.taskPresentation.description",
      defaultValue: "all-tasks-tree",
      options: Object.freeze([
        { value: "all-tasks-tree", labelKey: "plugins.androidGradle.taskPresentation.allTasksTree" },
        { value: "quick-actions-tree", labelKey: "plugins.androidGradle.taskPresentation.quickActionsTree" },
      ]),
    }] as const),
  }),
  matches: (context: SdkPluginMatchContext) => detectAndroidGradlePluginEvidence(context)?.android === true,
  evidenceKey: (context: SdkPluginMatchContext) => {
    const evidence = detectAndroidGradlePluginEvidence(context);
    const catalog = catalogEvidence(context.evidence);
    return evidence ? JSON.stringify([
      evidence.platform,
      evidence.bounded,
      evidence.catalogTruncated,
      evidence.gradle,
      evidence.android,
      evidence.wrapper,
      evidence.evidence,
      catalog ? fingerprintPaths(catalog.files, catalog.platform) : [],
    ]) : "unsupported";
  },
  activate: (context: SdkPluginActivationContext) => {
    const detected = detectAndroidGradlePluginEvidence(context);
    if (!detected || !detected.android) return;
    const detection = detected;
    const cache: SdkPluginTaskCacheCapability = context.taskCache;
    const catalog = catalogEvidence(context.evidence)?.files ?? [];
    const cachePaths = fingerprintPaths(catalog, detection.platform);
    const listeners = new Set<() => void>();
    let disposed = false;
    let revision = 0;
    let currentFingerprint: { readonly digest: string | null } | null = null;
    const cacheMissReason: SdkTaskProviderCacheMetadata["staleReason"] = "cache-miss";
    const publish = () => { if (disposed) return; for (const listener of listeners) listener(); };
    const metadata = (status: SdkTaskProviderCacheMetadata["status"], staleReason?: SdkTaskProviderCacheMetadata["staleReason"], restoredTaskCount?: number): SdkTaskProviderCacheMetadata => ({
      status, ...(staleReason ? { staleReason } : {}), ...(restoredTaskCount === undefined ? {} : { restoredTaskCount }),
    });
    let snapshot: GradleTaskDiscoveryResult = {
      status: cache ? "ready" : "unavailable",
      tasks: [],
      ...(cache ? { cache: metadata("validating") } : { unavailableReason: detection.catalogTruncated ? "evidence-incomplete" : "discovery-not-supported" }),
    };
    const provider: AndroidProviderContribution = {
      kind: "provider",
      id: "gradle-tasks",
      label: "Gradle",
      settingsFocus: "taskPresentation",
      snapshot: () => snapshot,
      subscribe: (listener) => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
      invalidate: (invalidation) => {
        if (!cache || disposed) return;
        const reason = invalidation.recovery === "none"
          ? intersectsFingerprintPaths(cachePaths, invalidation.paths, detection.platform) ? "watcher-change" : null
          : "overflow-recovery";
        if (!reason) return;
        revision += 1;
        snapshot = { ...snapshot, cache: metadata("stale", reason), tasks: disableTasks(snapshot.tasks) };
        currentFingerprint = null;
        publish();
        return cache.markDirty("gradle-tasks", reason === "overflow-recovery" ? "watcher-ambiguous" : "workspace-change")
          .then(() => undefined, () => undefined);
      },
      refresh: () => {
        if (disposed) return null;
        const refreshRevision = ++revision;
        const retainedTasks = snapshot.tasks;
        const prepared = buildGradleWrapperRequest(detection);
        if (!prepared.supported) {
          snapshot = { status: "unavailable", tasks: disableTasks(retainedTasks), cache: metadata("stale", "fingerprint-unavailable"), unavailableReason: prepared.reason === "wrapper-missing" ? "discovery-not-supported" : "evidence-incomplete" };
          publish();
          return null;
        }
        const plan: PluginTaskRefreshPlan = {
          request: prepared.request,
          apply: (result: PluginTaskExecutionResult) => {
            if (disposed || revision !== refreshRevision) return;
            if (result.status !== "succeeded") {
              snapshot = { status: "error", tasks: disableTasks(retainedTasks), cache: metadata("stale", "refresh-failed"), error: result.error ?? (result.status === "cancelled" ? "Gradle task discovery was cancelled." : `Gradle task discovery ${result.status}.`) };
              publish();
              return;
            }
            if (result.truncated) {
              snapshot = { status: "error", tasks: disableTasks(retainedTasks), cache: metadata("stale", "refresh-failed"), error: "Gradle task discovery output was truncated." };
              publish();
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
                  snapshot = { status: "error", tasks: disableTasks(retainedTasks), cache: metadata("stale", "refresh-failed"), error: "Gradle task discovery output exceeded the discovery limit." };
                  publish();
                  return;
                }
                chunks.push(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
              } catch {
                snapshot = { status: "error", tasks: disableTasks(retainedTasks), cache: metadata("stale", "refresh-failed"), error: "Gradle task discovery output was invalid." };
                publish();
                return;
              }
            }
            const bytes = new Uint8Array(byteLength);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            const parsed = parseGradleTasksOutput(bytes);
            if (parsed.status !== "ready") {
              snapshot = { ...parsed, tasks: disableTasks(retainedTasks), cache: metadata("stale", "refresh-failed") };
              publish();
              return;
            }
            const discovered = withGradleQuickActions(runnableGradleSnapshot(parsed));
            snapshot = { ...discovered, tasks: discovered.tasks.map((task) => ({ ...task, runnable: false })), ...(cache ? { cache: metadata("validating", undefined, discovered.tasks.length) } : {}) };
            publish();
            if (cache) void finalizeRefresh(discovered.tasks, refreshRevision);
          },
        };
        snapshot = { status: "loading", tasks: retainedTasks };
        publish();
        return plan;
      },
      run: async (taskId: string) => {
        if (disposed) return null;
        if (cache) {
          const fingerprint = await cache.computeFingerprint(cachePaths);
          if (disposed) return null;
          if (fingerprint.status !== "ready" || !currentFingerprint || fingerprint.digest !== currentFingerprint.digest) {
            snapshot = { ...snapshot, cache: metadata("stale", "fingerprint-mismatch"), tasks: snapshot.tasks.map((task) => ({ ...task, runnable: false })) };
            currentFingerprint = null;
            publish();
            return null;
          }
        }
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
    };
    const providerDisposable = context.contribute(provider);
    const commandDisposable = context.contribute({
      kind: "command", id: "refresh-gradle-tasks", providerId: "gradle-tasks", title: () => "Gradle", detail: () => "Gradle", execute: () => undefined,
    });
    if (cache) void restoreFromCache(revision);

    async function restoreFromCache(restoreRevision: number): Promise<void> {
      try {
        const read = await cache!.read("gradle-tasks");
        if (disposed || revision !== restoreRevision) return;
        const tasks = decodeAndroidGradleCachePayload(read.payloadBase64, ANDROID_GRADLE_PLUGIN_ID, ANDROID_GRADLE_PLUGIN.manifest.version, "gradle-tasks");
        if (!tasks) {
          snapshot = { status: "ready", tasks: [], cache: metadata("stale", read.status === "unavailable" ? "fingerprint-unavailable" : read.status === "miss" ? cacheMissReason : "cache-corrupt") };
          publish();
          return;
        }
        if (!detection.bounded || detection.catalogTruncated) {
          snapshot = { status: "ready", tasks: gradleTasks(tasks), cache: metadata("stale", "fingerprint-unavailable", tasks.length) };
          publish();
          return;
        }
        if (read.status !== "fresh") {
          const staleReason = read.status === "stale"
              ? read.staleReason === "expired" || read.staleReason === "future-timestamp" ? "cache-expired" : "cache-corrupt"
            : read.status === "dirty"
              ? read.dirtyReason === "watcher-ambiguous" ? "overflow-recovery" : read.dirtyReason === "manual" || read.dirtyReason === "unknown" ? cacheMissReason : "watcher-change"
              : read.status === "unavailable" ? "fingerprint-unavailable" : read.status === "miss" ? cacheMissReason : "cache-corrupt";
          snapshot = { status: "ready", tasks: gradleTasks(tasks), cache: metadata("stale", staleReason, tasks.length) };
          publish();
          return;
        }
        snapshot = { status: "ready", tasks: gradleTasks(tasks), cache: metadata("validating", undefined, tasks.length) };
        publish();
        const fingerprint = await cache!.computeFingerprint(cachePaths);
        if (disposed || revision !== restoreRevision) return;
        currentFingerprint = fingerprint.status === "ready" ? fingerprint : null;
        const match = fingerprint.status === "ready" && read.fingerprint?.digest === fingerprint.digest && read.status === "fresh";
        snapshot = { status: "ready", tasks: match ? gradleTasks(tasks).map((task) => ({ ...task, runnable: true })) : gradleTasks(tasks), cache: match ? metadata("ready", undefined, tasks.length) : metadata("stale", fingerprint.status === "ready" ? "fingerprint-mismatch" : "fingerprint-unavailable", tasks.length) };
        if (!match) currentFingerprint = null;
        publish();
      } catch {
        if (disposed) return;
        snapshot = { status: "ready", tasks: [], cache: metadata("stale", "cache-corrupt") };
        publish();
      }
    }

    async function finalizeRefresh(tasks: readonly TaskDescriptor[], refreshRevision: number): Promise<void> {
      try {
        const fingerprint = await cache!.computeFingerprint(cachePaths);
        if (disposed || revision !== refreshRevision) return;
        if (fingerprint.status !== "ready") {
          snapshot = { ...snapshot, cache: metadata("stale", "fingerprint-unavailable") };
          publish();
          return;
        }
        const payload = encodeAndroidGradleCachePayload(tasks, ANDROID_GRADLE_PLUGIN_ID, ANDROID_GRADLE_PLUGIN.manifest.version, "gradle-tasks");
        const stored = await cache!.write("gradle-tasks", fingerprint, payload);
        if (disposed || revision !== refreshRevision) return;
        if (stored.status !== "stored") {
          snapshot = { ...snapshot, cache: metadata("stale", "cache-corrupt") };
          publish();
          return;
        }
        currentFingerprint = fingerprint;
        snapshot = { ...snapshot, status: "ready", tasks: gradleTasks(tasks).map((task) => ({ ...task, runnable: true })), cache: metadata("ready", undefined, tasks.length) };
        publish();
      } catch {
        if (disposed) return;
        snapshot = { ...snapshot, cache: metadata("stale", "cache-corrupt") };
        publish();
      }
    }

    function gradleTasks(tasks: readonly TaskDescriptor[]): readonly GradleTaskDescriptor[] {
      return tasks.map((task) => ({ ...task, projectPath: task.projectPath ?? ":" }));
    }
    function disableTasks(tasks: readonly TaskDescriptor[]): readonly GradleTaskDescriptor[] {
      return gradleTasks(tasks).map((task) => ({ ...task, runnable: false }));
    }
    return {
      dispose: () => {
        disposed = true;
        listeners.clear();
        void providerDisposable.dispose();
        void commandDisposable.dispose();
      },
    };
  },
});

function withGradleQuickActions(snapshot: GradleTaskDiscoveryResult): GradleTaskDiscoveryResult {
  if (snapshot.status !== "ready") return snapshot;
  const quickActions = new Map(deriveGradleQuickActions(snapshot).actions.map((action) => [action.taskId, action]));
  return {
    ...snapshot,
    tasks: snapshot.tasks.map((task) => {
      const quick = quickActions.get(task.id);
      return quick ? withQuickAction(task, { kind: quick.kind, module: quick.module, variant: quick.variant }) : task;
    }),
  };
}

export function detectAndroidGradlePluginEvidence(
  context: SdkPluginMatchContext,
): AndroidGradleEvidenceSnapshot | null {
  const catalog = catalogEvidence(context.evidence);
  if (!catalog) return null;
  return detectAndroidGradleEvidence({
    workspaceRoot: context.identity.root,
    generation: context.identity.generation,
    platform: catalog.platform,
    files: catalog.files,
    catalogTruncated: catalog.truncated,
  });
}

function catalogEvidence(evidence: unknown): { readonly platform: "posix" | "windows"; readonly truncated: boolean; readonly files: readonly { readonly workspacePath: string }[] } | null {
  const value = Array.isArray(evidence)
    ? evidence.find((candidate): candidate is SdkWorkspaceEvidence => Boolean(candidate && typeof candidate === "object" && (candidate as SdkWorkspaceEvidence).kind === "workspace-catalog"))?.values
    : evidence && typeof evidence === "object" && (evidence as { kind?: unknown }).kind === "workspace-catalog" ? evidence as Record<string, unknown> : null;
  if (!value) return null;
  const platform = value.platform;
  const truncated = value.truncated;
  const files = value.files;
  if ((platform !== "posix" && platform !== "windows") || typeof truncated !== "boolean" || !Array.isArray(files)) return null;
  const paths = files.map((file) => typeof file === "string" ? file : file && typeof file === "object" && typeof (file as { workspacePath?: unknown }).workspacePath === "string" ? (file as { workspacePath: string }).workspacePath : null);
  if (paths.some((file) => file === null)) return null;
  return { platform, truncated, files: paths.map((workspacePath) => ({ workspacePath: workspacePath as string })) };
}
