import type { CommandDescriptor } from "../application/commands/command-service.ts";
import type { PluginWorkspaceIdentity } from "../application/plugins/index.ts";
import type { TasksCopy } from "../localization/catalog.ts";
import type { ProjectFile } from "../models.ts";
import { TasksController } from "../features/tasks/tasks-controller.ts";
import { TasksRuntime } from "../features/tasks/tasks-runtime.ts";
import { PluginCompositionRuntime } from "./plugin-runtime.ts";

export interface PluginTasksRuntimeOptions {
  readonly copy: () => TasksCopy;
  readonly registerCommand: (descriptor: CommandDescriptor) => () => void;
  readonly reportError: (error: unknown) => void;
  readonly platform?: () => "posix" | "windows";
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

  constructor(root: HTMLElement, options: PluginTasksRuntimeOptions) {
    const controller = new TasksController();
    this.plugins = new PluginCompositionRuntime({
      registerCommand: options.registerCommand,
      replaceProviders: (identity, providers) => controller.acceptProviders(identity, providers),
      reportDiagnostic: (diagnostic) => options.reportError(diagnostic.error ?? new Error(diagnostic.message)),
      reportError: options.reportError,
    });
    this.tasks = new TasksRuntime(root, controller, {
      copy: options.copy,
      runTask: (taskKey, identity) => this.plugins.runTask(taskKey, identity),
      refresh: (identity) => this.plugins.refreshProviders(identity),
      error: options.reportError,
    });
    this.platform = options.platform ?? browserPathPlatform;
    this.reportError = options.reportError;
  }

  async activateWorkspace(identity: PluginWorkspaceIdentity): Promise<void> {
    this.tasks.activate(identity);
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

  render(): void { this.tasks.render(); }

  dispose(): void {
    this.plugins.dispose();
    this.tasks.dispose();
  }
}

function browserPathPlatform(): "posix" | "windows" {
  return /Windows/i.test(globalThis.navigator?.userAgent ?? "") ? "windows" : "posix";
}
