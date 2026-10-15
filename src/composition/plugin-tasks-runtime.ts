import type { CommandDescriptor } from "../application/commands/command-service.ts";
import type {
  PluginManagementSnapshot,
  PluginManagementEntry,
  PluginSettingValue,
  PluginSettingsTargetResolution,
  PluginWorkspaceInvalidation,
  PluginWorkspaceIdentity,
} from "../application/plugins/index.ts";
import type { TasksCopy } from "../localization/catalog.ts";
import type { ProjectFile } from "../models.ts";
import type { TaskExecutionBridge } from "../protocol/task-execution.ts";
import { parseTaskArtifactDiscovery, type TaskArtifactBridge } from "../protocol/task-artifacts.ts";
import { TaskExecutionController } from "../application/tasks/task-execution-controller.ts";
import { TaskExecutionRuntime } from "../features/tasks/task-execution-runtime.ts";
import type { TaskConfirmationPresentation } from "../features/tasks/task-execution-view.ts";
import type { PluginTaskExecutionResult, PluginTaskRefreshPlan, PluginTaskRunPlan } from "../application/plugins/plugin-types.ts";
import { EN_US_TASK_EXECUTION_COPY, ZH_CN_TASK_EXECUTION_COPY } from "../localization/task-execution-copy.ts";
import { TasksController } from "../features/tasks/tasks-controller.ts";
import { TasksRuntime } from "../features/tasks/tasks-runtime.ts";
import type { TaskPresentation } from "../features/tasks/tasks-model.ts";
import { PluginCompositionRuntime } from "./plugin-runtime.ts";
import { PluginTaskBusyError } from "./plugin-contribution-runtime.ts";
import { RecentTaskStore, type RecentTaskStorage } from "../application/tasks/recent-task-store.ts";
import type { PluginTaskCacheBridge } from "../protocol/plugin-task-cache.ts";

export interface PluginTasksRuntimeOptions {
  readonly copy: () => TasksCopy;
  readonly registerCommand: (descriptor: CommandDescriptor) => () => void;
  readonly reportError: (error: unknown) => void;
  readonly platform?: () => "posix" | "windows";
  readonly locale?: () => "en-US" | "zh-CN";
  readonly executionBridge: TaskExecutionBridge;
  readonly artifactBridge: TaskArtifactBridge;
  readonly taskCacheBridge: PluginTaskCacheBridge;
  readonly recentTaskStorage?: RecentTaskStorage;
  readonly reconcileAfterTask?: (identity: PluginWorkspaceIdentity) => void | Promise<void>;
}

export interface PluginWorkspaceCatalog {
  readonly files: readonly ProjectFile[];
  readonly truncated: boolean;
}

/** Owns the window-level bridge from reviewed plugin contributions to the Tasks surface. */
export class PluginTasksRuntime {
  private readonly tasks: TasksRuntime;
  private readonly plugins: PluginCompositionRuntime;
  private readonly platform: () => "posix" | "windows";
  private readonly reportError: (error: unknown) => void;
  private readonly execution: TaskExecutionRuntime;
  private readonly recentTasks: RecentTaskStore | null;
  private readonly artifactBridge: TaskArtifactBridge;
  private readonly reconcileAfterTask: ((identity: PluginWorkspaceIdentity) => void | Promise<void>) | undefined;
  private readonly executionBridge: TaskExecutionBridge;
  private readonly locale: () => "en-US" | "zh-CN";
  private readonly managementListeners = new Set<(snapshot: PluginManagementSnapshot) => void>();
  private readonly releaseManagement: () => void;
  private readonly workspaceTrust = new Map<string, "loading" | "unknown" | "trusted" | "denied" | "error">();
  private identity: PluginWorkspaceIdentity | null = null;

  constructor(root: HTMLElement, options: PluginTasksRuntimeOptions) {
    this.recentTasks = options.recentTaskStorage ? new RecentTaskStore(options.recentTaskStorage) : null;
    this.artifactBridge = options.artifactBridge;
    this.reconcileAfterTask = options.reconcileAfterTask;
    this.executionBridge = options.executionBridge;
    this.locale = options.locale ?? (() => "en-US");
    const controller = new TasksController();
    const executionController = new TaskExecutionController(options.executionBridge);
    this.execution = new TaskExecutionRuntime(
      root,
      executionController,
      () => options.locale?.() === "zh-CN" ? ZH_CN_TASK_EXECUTION_COPY : EN_US_TASK_EXECUTION_COPY,
      {
        retry: (identity, taskKey) => { void this.plugins.runTask(taskKey, identity).catch(options.reportError); },
        revealArtifact: async (identity, artifact) => {
          if (!this.matches(identity)) return;
          await this.artifactBridge.revealTaskArtifact(identity.root, artifact.workspacePath);
        },
        reportError: options.reportError,
        visibilityChanged: () => this.render(),
        backgroundAfterStart: () => true,
        executionTimeoutMs: (request) => request.pluginId === "dev.asterlyn.android-gradle" && request.providerId === "gradle-tasks" && request.taskId === "discover" ? 120_000 : null,
        taskConfirmation: (request) => this.taskConfirmationPresentation(request.pluginId),
      },
    );
    this.plugins = new PluginCompositionRuntime({
      registerCommand: options.registerCommand,
      replaceProviders: (identity, providers) => controller.acceptProviders(identity, providers),
      reportDiagnostic: (diagnostic) => options.reportError(diagnostic.error ?? new Error(diagnostic.message)),
      reportError: options.reportError,
      executeTaskRefresh: (identity, plan, signal) => this.executeTaskRefresh(identity, plan, signal),
      executeTaskRun: (identity, plan, signal) => this.executeTaskRun(identity, plan, signal),
      providerRefreshTitle: (providerLabel) => `${options.copy().refresh}: ${providerLabel}`,
      taskCacheBridge: options.taskCacheBridge,
    });
    this.releaseManagement = this.plugins.subscribeManagement((snapshot) => {
      this.applyTaskPresentation(snapshot);
      this.publishManagement();
    });
    this.tasks = new TasksRuntime(root, controller, {
      copy: options.copy,
      refresh: (identity) => this.plugins.refreshProviders(identity),
      cancel: (identity) => this.plugins.cancelTask(identity),
      runTask: (taskKey, identity) => this.plugins.runTask(taskKey, identity),
      revealOutput: (taskKey, identity) => { this.execution.reveal(taskKey, identity); },
      error: (error) => options.reportError(error instanceof PluginTaskBusyError ? new Error(options.copy().busy) : error),
    });
    this.platform = options.platform ?? browserPathPlatform;
    this.reportError = options.reportError;
  }

  async activateWorkspace(identity: PluginWorkspaceIdentity): Promise<void> {
    this.identity = Object.freeze({ root: identity.root, generation: identity.generation });
    this.workspaceTrust.clear();
    this.tasks.activate(identity);
    this.execution.activate(identity);
    await this.plugins.activateWorkspace(identity);
    const snapshot = this.plugins.managementSnapshot;
    if (snapshot.entries.some((entry) => entry.taskAuthorization !== undefined)) {
      await this.loadWorkspaceTrust(snapshot);
    } else {
      this.publishManagement();
    }
  }

  async updateWorkspaceEvidence(
    identity: PluginWorkspaceIdentity,
    catalog: PluginWorkspaceCatalog,
  ): Promise<void> {
    try {
      await this.plugins.updateWorkspaceEvidence(identity, {
        kind: "workspace-catalog",
        platform: this.platform(),
        files: catalog.files.map(({ workspacePath }) => ({ workspacePath })),
        truncated: catalog.truncated,
      });
    } catch (error) {
      this.reportError(error);
    }
  }

  render(): void {
    this.tasks.render();
    this.execution.render();
  }

  get pluginManagementSnapshot(): PluginManagementSnapshot {
    return this.managementSnapshot(this.plugins.managementSnapshot);
  }

  async loadPluginManagement(): Promise<PluginManagementSnapshot> {
    const snapshot = await this.plugins.loadManagementCatalog();
    this.applyTaskPresentation(snapshot);
    await this.loadWorkspaceTrust(snapshot);
    return this.pluginManagementSnapshot;
  }

  subscribePluginManagement(listener: (snapshot: PluginManagementSnapshot) => void): () => void {
    this.managementListeners.add(listener);
    return () => this.managementListeners.delete(listener);
  }

  setPluginEnabled(pluginId: string, enabled: boolean): boolean {
    return this.plugins.setPluginEnabled(pluginId, enabled);
  }

  setPluginSetting(pluginId: string, settingId: string, value: PluginSettingValue): boolean {
    const changed = this.plugins.setPluginSetting(pluginId, settingId, value);
    if (changed && pluginId === "dev.asterlyn.android-gradle" && settingId === "taskPresentation" && isTaskPresentation(value)) {
      this.tasks.setPresentation(value);
    }
    return changed;
  }

  async setPluginWorkspaceTrust(pluginId: string, trusted: boolean): Promise<boolean> {
    const identity = this.identity;
    const entry = this.plugins.managementSnapshot.entries.find((candidate) => candidate.id === pluginId);
    if (!identity || !entry?.taskAuthorization) return false;
    const current = this.workspaceTrust.get(pluginId);
    const requested = trusted ? "trusted" : "denied";
    if (current === requested) return false;
    this.workspaceTrust.set(pluginId, "loading");
    this.publishManagement();
    try {
      const result = await this.executionBridge.setWorkspaceTrust(identity.root, pluginId, requested);
      if (!this.matches(identity) || result.workspaceRoot !== identity.root ||
        result.pluginId !== pluginId || result.state !== requested) {
        throw new Error("Plugin workspace trust response is stale.");
      }
      this.workspaceTrust.set(pluginId, result.state);
      this.publishManagement();
      return true;
    } catch (error) {
      if (this.matches(identity)) {
        this.workspaceTrust.set(pluginId, "error");
        this.publishManagement();
      }
      throw error;
    }
  }

  /** Settings owners are null, one target, or many targets; many intentionally deep-link nowhere. */
  pluginSettingsTargets(): PluginSettingsTargetResolution {
    return this.plugins.pluginSettingsTargets();
  }

  async invalidateWorkspace(
    identity: PluginWorkspaceIdentity,
    invalidation: PluginWorkspaceInvalidation,
  ): Promise<void> {
    try {
      await this.plugins.invalidateWorkspace(identity, invalidation);
    } catch (error) {
      this.reportError(error);
    }
  }

  dispose(): void {
    this.identity = null;
    this.releaseManagement();
    this.managementListeners.clear();
    this.plugins.dispose();
    this.execution.dispose();
    this.tasks.dispose();
  }

  private async executeTaskRefresh(
    identity: PluginWorkspaceIdentity,
    plan: PluginTaskRefreshPlan,
    signal: AbortSignal,
  ): Promise<PluginTaskExecutionResult> {
    return this.executeTask(identity, plan, signal);
  }

  private async executeTaskRun(
    identity: PluginWorkspaceIdentity,
    plan: PluginTaskRunPlan,
    signal: AbortSignal,
  ): Promise<PluginTaskExecutionResult> {
    const result = await this.executeTask(identity, plan, signal);
    this.recentTasks?.record({
      pluginId: plan.request.pluginId,
      providerId: plan.request.providerId,
      taskId: plan.request.taskId,
      label: plan.request.label,
      status: result.status,
      timestamp: Date.now(),
    });
    if (result.status === "succeeded") {
      if (plan.artifactSearch) this.scheduleArtifactDiscovery(identity, plan);
      void Promise.resolve().then(() => this.reconcileAfterTask?.(identity)).catch(this.reportError);
    }
    return result;
  }

  private scheduleArtifactDiscovery(identity: PluginWorkspaceIdentity, plan: PluginTaskRunPlan): void {
    const search = plan.artifactSearch;
    if (!search || !this.matches(identity)) return;
    const taskKey = `${plan.request.pluginId}.${plan.request.providerId}:${plan.request.taskId}`;
    const target = this.execution.beginArtifactDiscovery(identity, taskKey);
    if (!target) return;
    void this.artifactBridge.discoverTaskArtifacts(identity.root, [...search.hints]).then((value) => {
      if (!this.matches(identity) || !this.execution.isArtifactTargetCurrent(target)) return;
      this.execution.completeArtifactDiscovery(target, parseTaskArtifactDiscovery(value));
    }).catch((error) => {
      if (!this.matches(identity) || !this.execution.failArtifactDiscovery(target)) return;
      this.reportError(error);
    });
  }

  private matches(identity: PluginWorkspaceIdentity): boolean {
    return this.identity?.root === identity.root && this.identity.generation === identity.generation;
  }

  private applyTaskPresentation(snapshot: PluginManagementSnapshot): void {
    const setting = snapshot.entries.find((entry) => entry.id === "dev.asterlyn.android-gradle")?.settings.taskPresentation;
    if (setting !== undefined && isTaskPresentation(setting)) this.tasks.setPresentation(setting);
  }

  private taskConfirmationPresentation(pluginId: string): TaskConfirmationPresentation | null {
    const entry = this.plugins.managementSnapshot.entries.find((candidate) => candidate.id === pluginId);
    const descriptor = entry?.taskAuthorization?.taskConfirmation;
    if (!entry || !descriptor) return null;
    return {
      label: pluginMessage(entry, this.locale(), descriptor.rememberLabelKey),
      ...(descriptor.rememberDescriptionKey === undefined
        ? {}
        : { description: pluginMessage(entry, this.locale(), descriptor.rememberDescriptionKey) }),
    };
  }

  private async loadWorkspaceTrust(snapshot: PluginManagementSnapshot): Promise<void> {
    const identity = this.identity;
    if (!identity) {
      this.workspaceTrust.clear();
      this.publishManagement();
      return;
    }
    const pluginIds = snapshot.entries
      .filter((entry) => entry.taskAuthorization !== undefined)
      .map((entry) => entry.id);
    for (const pluginId of pluginIds) this.workspaceTrust.set(pluginId, "loading");
    this.publishManagement();
    await Promise.all(pluginIds.map(async (pluginId) => {
      try {
        const result = await this.executionBridge.readWorkspaceTrust(identity.root, pluginId);
        if (!this.matches(identity) || result.workspaceRoot !== identity.root || result.pluginId !== pluginId) return;
        this.workspaceTrust.set(pluginId, result.state);
      } catch (error) {
        if (this.matches(identity)) this.workspaceTrust.set(pluginId, "error");
        this.reportError(error);
      }
    }));
    if (this.matches(identity)) this.publishManagement();
  }

  private managementSnapshot(snapshot: PluginManagementSnapshot): PluginManagementSnapshot {
    return Object.freeze({
      schemaVersion: 1,
      entries: Object.freeze(snapshot.entries.map((entry) => entry.taskAuthorization === undefined
        ? entry
        : Object.freeze({
            ...entry,
            workspaceTrust: this.identity
              ? (this.workspaceTrust.get(entry.id) ?? "loading")
              : "unavailable",
          }))),
    });
  }

  private publishManagement(): void {
    const snapshot = this.pluginManagementSnapshot;
    for (const listener of this.managementListeners) listener(snapshot);
  }

  private async executeTask(
    identity: PluginWorkspaceIdentity,
    plan: PluginTaskRefreshPlan,
    signal: AbortSignal,
  ): Promise<PluginTaskExecutionResult> {
    return new Promise<PluginTaskExecutionResult>((resolve) => {
      let settled = false;
      const complete = (result: PluginTaskExecutionResult) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        resolve(result);
      };
      const abort = () => {
        void this.execution.cancel(identity).then(() => complete({
          status: "cancelled",
          outputs: [],
          truncated: false,
          error: "Task refresh was cancelled.",
        })).catch((error) => complete({
          status: "crashed",
          outputs: [],
          truncated: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        complete({ status: "cancelled", outputs: [], truncated: false, error: "Task refresh was cancelled." });
        return;
      }
      void this.execution.prepare(identity, plan.request, complete).then(() => {
        if (signal.aborted) abort();
      }).catch((error) => complete({
        status: "crashed",
        outputs: [],
        truncated: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }
}

function pluginMessage(entry: PluginManagementEntry, locale: string, key: string): string {
  return entry.localization.locales[locale]?.[key] ??
    entry.localization.locales[entry.localization.defaultLocale]?.[key] ?? key;
}

function browserPathPlatform(): "posix" | "windows" {
  return /Windows/i.test(globalThis.navigator?.userAgent ?? "") ? "windows" : "posix";
}

function isTaskPresentation(value: PluginSettingValue): value is TaskPresentation {
  return value === "all-tasks-tree" || value === "quick-actions-tree";
}
