import type { CommandDescriptor } from "../application/commands/command-service.ts";
import type { PluginWorkspaceIdentity } from "../application/plugins/index.ts";
import type { TasksCopy } from "../localization/catalog.ts";
import type { ProjectFile } from "../models.ts";
import type { TaskExecutionBridge } from "../protocol/task-execution.ts";
import { TaskExecutionController } from "../application/tasks/task-execution-controller.ts";
import { TaskExecutionRuntime } from "../features/tasks/task-execution-runtime.ts";
import type { PluginTaskExecutionResult, PluginTaskRefreshPlan } from "../application/plugins/plugin-types.ts";
import { EN_US_TASK_EXECUTION_COPY, ZH_CN_TASK_EXECUTION_COPY } from "../localization/task-execution-copy.ts";
import { TasksController } from "../features/tasks/tasks-controller.ts";
import { TasksRuntime } from "../features/tasks/tasks-runtime.ts";
import { PluginCompositionRuntime } from "./plugin-runtime.ts";

export interface PluginTasksRuntimeOptions {
  readonly copy: () => TasksCopy;
  readonly registerCommand: (descriptor: CommandDescriptor) => () => void;
  readonly reportError: (error: unknown) => void;
  readonly platform?: () => "posix" | "windows";
  readonly locale?: () => "en-US" | "zh-CN";
  readonly executionBridge: TaskExecutionBridge;
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
  private readonly root: HTMLElement;

  constructor(root: HTMLElement, options: PluginTasksRuntimeOptions) {
    this.root = root;
    const controller = new TasksController();
    const executionController = new TaskExecutionController(options.executionBridge);
    this.execution = new TaskExecutionRuntime(
      root,
      executionController,
      () => options.locale?.() === "zh-CN" ? ZH_CN_TASK_EXECUTION_COPY : EN_US_TASK_EXECUTION_COPY,
    );
    this.plugins = new PluginCompositionRuntime({
      registerCommand: options.registerCommand,
      replaceProviders: (identity, providers) => controller.acceptProviders(identity, providers),
      reportDiagnostic: (diagnostic) => options.reportError(diagnostic.error ?? new Error(diagnostic.message)),
      reportError: options.reportError,
      executeTaskRefresh: (identity, plan, signal) => this.executeTaskRefresh(identity, plan, signal),
      providerRefreshTitle: (providerLabel) => `${options.copy().refresh}: ${providerLabel}`,
    });
    this.tasks = new TasksRuntime(root, controller, {
      copy: options.copy,
      refresh: (identity) => this.plugins.refreshProviders(identity),
      error: options.reportError,
      shouldRender: () => !this.execution.active,
    });
    this.platform = options.platform ?? browserPathPlatform;
    this.reportError = options.reportError;
  }

  async activateWorkspace(identity: PluginWorkspaceIdentity): Promise<void> {
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
    if (this.execution.active) this.execution.render();
    else this.tasks.render();
  }

  dispose(): void {
    this.plugins.dispose();
    this.execution.dispose();
    this.tasks.dispose();
  }

  private async executeTaskRefresh(
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
        queueMicrotask(() => {
          const fallback = this.root.querySelector<HTMLElement>("[data-tasks-action=refresh]");
          this.execution.restoreFocus(fallback);
        });
      };
      const abort = () => {
        void this.execution.cancel(identity).catch((error) => complete({
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
