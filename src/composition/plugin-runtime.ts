import {
  PluginRuntime,
  type BundledPlugin,
  type PluginDiagnostic,
  type PluginWorkspaceCatalogEvidence,
  type PluginWorkspaceIdentity,
} from "../application/plugins/index.ts";
import type { CommandDescriptor } from "../application/commands/command-service.ts";
import type { TaskProviderProjection } from "../features/tasks/index.ts";
import type { PluginTaskExecutionResult, PluginTaskRefreshPlan } from "../application/plugins/plugin-types.ts";
import { PluginContributionRuntime } from "./plugin-contribution-runtime.ts";

export interface PluginCompositionRuntimeOptions {
  readonly registerCommand: (descriptor: CommandDescriptor) => () => void;
  readonly replaceProviders: (
    identity: PluginWorkspaceIdentity,
    providers: readonly TaskProviderProjection[],
  ) => void;
  readonly reportDiagnostic: (diagnostic: PluginDiagnostic) => void;
  readonly reportError: (error: unknown) => void;
  readonly executeTaskRefresh: (
    identity: PluginWorkspaceIdentity,
    plan: PluginTaskRefreshPlan,
    signal: AbortSignal,
  ) => Promise<PluginTaskExecutionResult>;
  readonly providerRefreshTitle?: (providerLabel: string) => string;
  readonly loadPlugins?: () => Promise<readonly BundledPlugin[]>;
}

/** Window-scoped orchestration. Bundled plugin code stays behind a lazy project-evidence gate. */
export class PluginCompositionRuntime {
  private readonly runtime: PluginRuntime;
  private readonly contributions: PluginContributionRuntime;
  private readonly loadPlugins: () => Promise<readonly BundledPlugin[]>;
  private identity: PluginWorkspaceIdentity | null = null;
  private evidenceKey: string | null = null;
  private pluginsPromise: Promise<readonly BundledPlugin[]> | null = null;
  private disposed = false;

  constructor(options: PluginCompositionRuntimeOptions) {
    this.runtime = new PluginRuntime(undefined, options.reportDiagnostic);
    this.contributions = new PluginContributionRuntime(this.runtime.contributions, options);
    this.loadPlugins = options.loadPlugins ?? (async () =>
      (await import("../plugins/bundled-plugins.ts")).BUNDLED_PLUGINS);
  }

  async activateWorkspace(identity: PluginWorkspaceIdentity): Promise<void> {
    if (this.disposed) return;
    this.identity = Object.freeze({ root: identity.root, generation: identity.generation });
    this.evidenceKey = null;
    this.contributions.activateWorkspace(this.identity);
    await this.runtime.deactivate();
  }

  async updateWorkspaceEvidence(
    identity: PluginWorkspaceIdentity,
    evidence: PluginWorkspaceCatalogEvidence,
  ): Promise<void> {
    if (!this.matches(identity) || this.disposed) return;
    const evidenceKey = catalogEvidenceKey(evidence);
    if (evidenceKey === this.evidenceKey) return;
    const plugins = await this.bundledPlugins();
    if (!this.matches(identity) || this.disposed) return;
    await this.runtime.activate(identity, evidence, plugins);
    if (this.matches(identity) && !this.disposed) this.evidenceKey = evidenceKey;
  }

  refreshProviders(identity: PluginWorkspaceIdentity): Promise<void> {
    return this.contributions.refreshProviders(identity);
  }


  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.identity = null;
    this.evidenceKey = null;
    this.contributions.dispose();
    void this.runtime.dispose();
  }

  private matches(identity: PluginWorkspaceIdentity): boolean {
    return this.identity?.root === identity.root && this.identity.generation === identity.generation;
  }

  private bundledPlugins(): Promise<readonly BundledPlugin[]> {
    this.pluginsPromise ??= this.loadPlugins();
    return this.pluginsPromise;
  }
}

function catalogEvidenceKey(evidence: PluginWorkspaceCatalogEvidence): string {
  return JSON.stringify([
    evidence.platform,
    evidence.truncated,
    evidence.files.map((file) => file.workspacePath).sort(),
  ]);
}
