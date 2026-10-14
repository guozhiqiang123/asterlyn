import {
  commandId,
  TOOL_FOCUS_SCOPES,
  type CommandDescriptor,
} from "../application/commands/command-service.ts";
import type {
  Disposable,
  PluginContributionRegistry,
  PluginProviderContribution,
  PluginWorkspaceIdentity,
  RegisteredPluginContribution,
} from "../application/plugins/index.ts";
import type { TaskProviderSnapshot } from "../application/tasks/index.ts";
import type { TaskProviderProjection } from "../features/tasks/index.ts";

type RegisteredCommand = Extract<RegisteredPluginContribution, { readonly kind: "command" }>;
type RegisteredProvider = Extract<RegisteredPluginContribution, { readonly kind: "provider" }>;

export interface PluginContributionRuntimeOptions {
  readonly registerCommand: (descriptor: CommandDescriptor) => () => void;
  readonly replaceProviders: (
    identity: PluginWorkspaceIdentity,
    providers: readonly TaskProviderProjection[],
  ) => void;
  readonly reportError: (error: unknown) => void;
}

/** Maps restricted plugin data into window-owned command and Tasks capabilities. */
export class PluginContributionRuntime {
  private readonly registry: PluginContributionRegistry;
  private readonly options: PluginContributionRuntimeOptions;
  private identity: PluginWorkspaceIdentity | null = null;
  private readonly commands = new Map<string, { contribution: RegisteredCommand; release: () => void }>();
  private readonly providers = new Map<string, { contribution: RegisteredProvider; release: () => void }>();
  private readonly releaseRegistry: () => void;
  private disposed = false;

  constructor(
    registry: PluginContributionRegistry,
    options: PluginContributionRuntimeOptions,
  ) {
    this.registry = registry;
    this.options = options;
    this.releaseRegistry = registry.subscribe(() => this.reconcile());
  }

  activateWorkspace(identity: PluginWorkspaceIdentity): void {
    if (this.disposed) return;
    this.identity = Object.freeze({ root: identity.root, generation: identity.generation });
    this.options.replaceProviders(this.identity, []);
  }

  async refreshProviders(identity: PluginWorkspaceIdentity): Promise<void> {
    if (!this.matches(identity)) return;
    const operations = [...this.providers.values()]
      .map(({ contribution }) => contribution.refresh)
      .filter((refresh): refresh is NonNullable<PluginProviderContribution["refresh"]> => Boolean(refresh))
      .map(async (refresh) => {
        try { await refresh(); } catch (error) { this.options.reportError(error); }
      });
    await Promise.all(operations);
    this.publishProviders();
  }

  async runTask(taskKey: string, identity: PluginWorkspaceIdentity): Promise<void> {
    if (!this.matches(identity)) return;
    for (const { contribution } of this.providers.values()) {
      if (!contribution.run) continue;
      const snapshot = snapshotSafely(contribution, this.options.reportError);
      const task = snapshot.tasks.find((candidate) =>
        `${contribution.qualifiedId}:${candidate.id}` === taskKey,
      );
      if (!task?.runnable) continue;
      await contribution.run(task.id);
      return;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.identity = null;
    this.releaseRegistry();
    for (const entry of this.commands.values()) entry.release();
    for (const entry of this.providers.values()) entry.release();
    this.commands.clear();
    this.providers.clear();
  }

  private reconcile(): void {
    if (this.disposed) return;
    const contributions = this.registry.list();
    this.reconcileCommands(contributions.filter(isCommand));
    this.reconcileProviders(contributions.filter(isProvider));
  }

  private reconcileCommands(next: readonly RegisteredCommand[]): void {
    for (const [id, current] of this.commands) {
      const replacement = next.find((contribution) => contribution.qualifiedId === id);
      if (replacement === current.contribution) continue;
      current.release();
      this.commands.delete(id);
    }
    for (const contribution of next) {
      if (this.commands.has(contribution.qualifiedId)) continue;
      try {
        const release = this.options.registerCommand(commandDescriptor(contribution));
        this.commands.set(contribution.qualifiedId, { contribution, release });
      } catch (error) {
        this.options.reportError(error);
      }
    }
  }

  private reconcileProviders(next: readonly RegisteredProvider[]): void {
    for (const [id, current] of this.providers) {
      const replacement = next.find((contribution) => contribution.qualifiedId === id);
      if (replacement === current.contribution) continue;
      current.release();
      this.providers.delete(id);
    }
    for (const contribution of next) {
      if (this.providers.has(contribution.qualifiedId)) continue;
      let subscription: Disposable | null = null;
      try {
        subscription = contribution.subscribe?.(() => this.publishProviders()) ?? null;
      } catch (error) {
        this.options.reportError(error);
      }
      this.providers.set(contribution.qualifiedId, {
        contribution,
        release: () => {
          try {
            const result = subscription?.dispose();
            if (result instanceof Promise) void result.catch(this.options.reportError);
          } catch (error) {
            this.options.reportError(error);
          }
        },
      });
    }
    this.publishProviders();
  }

  private publishProviders(): void {
    if (!this.identity || this.disposed) return;
    const projections = [...this.providers.values()]
      .map(({ contribution }) => ({
        id: contribution.qualifiedId,
        label: contribution.label,
        snapshot: snapshotSafely(contribution, this.options.reportError),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    this.options.replaceProviders(this.identity, projections);
  }

  private matches(identity: PluginWorkspaceIdentity): boolean {
    return this.identity?.root === identity.root && this.identity.generation === identity.generation;
  }
}

function commandDescriptor(contribution: RegisteredCommand): CommandDescriptor {
  return {
    id: commandId(contribution.qualifiedId),
    category: "workspace",
    userBindingScopes: TOOL_FOCUS_SCOPES,
    title: () => safeText(contribution.title, contribution.qualifiedId),
    detail: () => safeText(contribution.detail, contribution.pluginId),
    ...(contribution.keywords
      ? { keywords: () => safeText(contribution.keywords!, contribution.pluginId) }
      : {}),
    availability: () => {
      try { return contribution.availability?.() ?? { enabled: true }; }
      catch { return { enabled: false, reason: contribution.pluginId }; }
    },
    execute: () => contribution.execute(),
  };
}

function snapshotSafely(
  contribution: RegisteredProvider,
  reportError: (error: unknown) => void,
): TaskProviderSnapshot {
  try { return contribution.snapshot(); }
  catch (error) {
    reportError(error);
    return { status: "error", tasks: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function safeText(read: () => string, fallback: string): string {
  try {
    const value = read().trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

function isCommand(contribution: RegisteredPluginContribution): contribution is RegisteredCommand {
  return contribution.kind === "command";
}

function isProvider(contribution: RegisteredPluginContribution): contribution is RegisteredProvider {
  return contribution.kind === "provider";
}
