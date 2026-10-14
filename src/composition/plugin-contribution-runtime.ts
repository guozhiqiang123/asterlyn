import {
  commandId,
  TOOL_FOCUS_SCOPES,
  type CommandDescriptor,
} from "../application/commands/command-service.ts";
import type {
  Disposable,
  PluginContributionRegistry,
  PluginTaskExecutionResult,
  PluginTaskRefreshPlan,
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
  readonly executeTaskRefresh: (
    identity: PluginWorkspaceIdentity,
    plan: PluginTaskRefreshPlan,
    signal: AbortSignal,
  ) => Promise<PluginTaskExecutionResult>;
  readonly providerRefreshTitle?: (providerLabel: string) => string;
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
  private refreshInFlight: Promise<void> | null = null;
  private refreshAbort: AbortController | null = null;

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
    this.abortRefresh();
    this.identity = Object.freeze({ root: identity.root, generation: identity.generation });
    this.refreshInFlight = null;
    this.options.replaceProviders(this.identity, []);
  }

  async refreshProviders(identity: PluginWorkspaceIdentity, providerQualifiedId?: string): Promise<void> {
    if (!this.matches(identity)) return;
    if (this.refreshInFlight) return this.refreshInFlight;
    const operation = this.refreshProvidersSerialized(identity, providerQualifiedId);
    this.refreshInFlight = operation;
    void operation.finally(() => { if (this.refreshInFlight === operation) this.refreshInFlight = null; });
    return this.refreshInFlight;
  }
  private async refreshProvidersSerialized(identity: PluginWorkspaceIdentity, providerQualifiedId?: string): Promise<void> {
    for (const { contribution } of this.providers.values()) {
      if (providerQualifiedId && contribution.qualifiedId !== providerQualifiedId) continue;
      if (!contribution.refresh) continue;
      try {
        const plan = await contribution.refresh();
        if (!this.matches(identity)) return;
        if (!plan) continue;
        if (!validRefreshPlan(plan, contribution)) throw new Error(`Invalid task refresh plan from ${contribution.qualifiedId}`);
        this.publishProviders();
        const abort = new AbortController();
        this.refreshAbort = abort;
        let result: PluginTaskExecutionResult;
        try {
          result = await this.options.executeTaskRefresh(identity, plan, abort.signal);
        } finally {
          if (this.refreshAbort === abort) this.refreshAbort = null;
        }
        if (this.matches(identity) && this.providers.get(contribution.qualifiedId)?.contribution === contribution) plan.apply(result);
      } catch (error) { this.options.reportError(error); }
    }
    this.publishProviders();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortRefresh();
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
        const release = this.options.registerCommand(commandDescriptor(
          contribution,
          () => {
            const identity = this.identity;
            return identity
              ? this.refreshProviders(identity, contribution.providerId
                ? `${contribution.pluginId}.${contribution.providerId}`
                : undefined)
              : Promise.resolve();
          },
          this.options.providerRefreshTitle,
        ));
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
      this.abortRefresh();
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

  private abortRefresh(): void {
    this.refreshAbort?.abort();
    this.refreshAbort = null;
  }
}

function commandDescriptor(
  contribution: RegisteredCommand,
  refresh: () => Promise<void>,
  providerRefreshTitle?: (providerLabel: string) => string,
): CommandDescriptor {
  return {
    id: commandId(contribution.qualifiedId),
    category: "workspace",
    userBindingScopes: TOOL_FOCUS_SCOPES,
    title: () => {
      const title = safeText(contribution.title, contribution.qualifiedId);
      return contribution.providerId && providerRefreshTitle ? providerRefreshTitle(title) : title;
    },
    detail: () => safeText(contribution.detail, contribution.pluginId),
    ...(contribution.keywords
      ? { keywords: () => safeText(contribution.keywords!, contribution.pluginId) }
      : {}),
    availability: () => {
      try { return contribution.availability?.() ?? { enabled: true }; }
      catch { return { enabled: false, reason: contribution.pluginId }; }
    },
    execute: () => contribution.providerId ? refresh() : contribution.execute(),
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

function validRefreshPlan(plan: PluginTaskRefreshPlan, contribution: RegisteredProvider): boolean {
  const request = plan && typeof plan === "object" ? plan.request : null;
  return Boolean(plan && typeof plan.apply === "function" && request &&
    request.pluginId === contribution.pluginId && request.providerId === contribution.id &&
    typeof request.taskId === "string" && typeof request.label === "string" &&
    typeof request.executablePath === "string" && Array.isArray(request.args) &&
    request.args.every((arg) => typeof arg === "string"));
}
