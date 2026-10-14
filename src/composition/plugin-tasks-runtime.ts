import type { CommandDescriptor } from "../application/commands/command-service.ts";
import type { PluginWorkspaceIdentity } from "../application/plugins/index.ts";
import type { TasksCopy } from "../localization/catalog.ts";
import type { ProjectFile } from "../models.ts";
import type { TaskExecutionBridge } from "../protocol/task-execution.ts";
import { parseTaskArtifactDiscovery, type TaskArtifactBridge } from "../protocol/task-artifacts.ts";
import { TaskExecutionController } from "../application/tasks/task-execution-controller.ts";
import { TaskExecutionRuntime } from "../features/tasks/task-execution-runtime.ts";
import type { PluginTaskExecutionResult, PluginTaskRefreshPlan, PluginTaskRunPlan } from "../application/plugins/plugin-types.ts";
import { EN_US_TASK_EXECUTION_COPY, ZH_CN_TASK_EXECUTION_COPY } from "../localization/task-execution-copy.ts";
import { TasksController } from "../features/tasks/tasks-controller.ts";
import { TasksRuntime } from "../features/tasks/tasks-runtime.ts";
import { PluginCompositionRuntime } from "./plugin-runtime.ts";
import { PluginTaskBusyError } from "./plugin-contribution-runtime.ts";
import { RecentTaskStore, type RecentTaskStorage } from "../application/tasks/recent-task-store.ts";

export interface PluginTasksRuntimeOptions {
  readonly copy: () => TasksCopy;
  readonly registerCommand: (descriptor: CommandDescriptor) => () => void;
  readonly reportError: (error: unknown) => void;
  readonly platform?: () => "posix" | "windows";
  readonly locale?: () => "en-US" | "zh-CN";
  readonly executionBridge: TaskExecutionBridge;
  readonly artifactBridge: TaskArtifactBridge;
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
  private identity: PluginWorkspaceIdentity | null = null;

  constructor(root: HTMLElement, options: PluginTasksRuntimeOptions) {
    this.recentTasks = options.recentTaskStorage ? new RecentTaskStore(options.recentTaskStorage) : null;
    this.artifactBridge = options.artifactBridge;
    this.reconcileAfterTask = options.reconcileAfterTask;
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
    this.tasks.activate(identity);
    this.execution.activate(identity);
    await this.plugins.activateWorkspace(identity);
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

  dispose(): void {
    this.identity = null;
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

function browserPathPlatform(): "posix" | "windows" {
  return /Windows/i.test(globalThis.navigator?.userAgent ?? "") ? "windows" : "posix";
}
