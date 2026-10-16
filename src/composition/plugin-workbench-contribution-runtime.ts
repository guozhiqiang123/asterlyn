import type {
  Disposable,
  PluginContributionRegistry,
  RegisteredPluginContribution,
} from "../application/plugins/index.ts";

type TargetProvider = Extract<RegisteredPluginContribution, { readonly kind: "execution-target-provider" }>;
type RunProvider = Extract<RegisteredPluginContribution, { readonly kind: "run-configuration-provider" }>;

export interface PluginWorkbenchSnapshot {
  readonly targetProviders: readonly {
    readonly qualifiedId: string;
    readonly pluginId: string;
    readonly providerId: string;
    readonly snapshot: ReturnType<TargetProvider["snapshot"]>;
  }[];
  readonly runConfigurationProviders: readonly {
    readonly qualifiedId: string;
    readonly pluginId: string;
    readonly providerId: string;
    readonly snapshot: ReturnType<RunProvider["snapshot"]>;
  }[];
}

export const EMPTY_PLUGIN_WORKBENCH_SNAPSHOT: PluginWorkbenchSnapshot = Object.freeze({
  targetProviders: Object.freeze([]),
  runConfigurationProviders: Object.freeze([]),
});

export class PluginWorkbenchContributionRuntime {
  private readonly registry: PluginContributionRegistry;
  private readonly changed: () => void;
  private readonly reportError: (error: unknown) => void;
  private readonly targets = new Map<string, { contribution: TargetProvider; release: () => void }>();
  private readonly runs = new Map<string, { contribution: RunProvider; release: () => void }>();
  private readonly releaseRegistry: () => void;
  private disposed = false;

  constructor(
    registry: PluginContributionRegistry,
    changed: () => void,
    reportError: (error: unknown) => void,
  ) {
    this.registry = registry;
    this.changed = changed;
    this.reportError = reportError;
    this.releaseRegistry = registry.subscribe(() => this.reconcile());
    this.reconcile();
  }

  snapshot(): PluginWorkbenchSnapshot {
    return {
      targetProviders: [...this.targets.values()].map(({ contribution }) => ({
        qualifiedId: contribution.qualifiedId,
        pluginId: contribution.pluginId,
        providerId: contribution.id,
        snapshot: contribution.snapshot(),
      })),
      runConfigurationProviders: [...this.runs.values()].map(({ contribution }) => ({
        qualifiedId: contribution.qualifiedId,
        pluginId: contribution.pluginId,
        providerId: contribution.id,
        snapshot: contribution.snapshot(),
      })),
    };
  }

  async refreshTargets(qualifiedId: string): Promise<void> {
    await this.targets.get(qualifiedId)?.contribution.refresh?.();
  }

  async selectTarget(qualifiedId: string, targetId: string | null): Promise<void> {
    await this.targets.get(qualifiedId)?.contribution.select?.(targetId);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseRegistry();
    releaseAll(this.targets);
    releaseAll(this.runs);
  }

  private reconcile(): void {
    if (this.disposed) return;
    const contributions = this.registry.list();
    reconcile(this.targets, contributions.filter(isTarget), this.changed, this.reportError);
    reconcile(this.runs, contributions.filter(isRun), this.changed, this.reportError);
    this.changed();
  }
}

function reconcile<T extends TargetProvider | RunProvider>(
  current: Map<string, { contribution: T; release: () => void }>,
  next: readonly T[],
  changed: () => void,
  reportError: (error: unknown) => void,
): void {
  for (const [id, entry] of current) {
    if (next.find((candidate) => candidate.qualifiedId === id) === entry.contribution) continue;
    entry.release();
    current.delete(id);
  }
  for (const contribution of next) {
    if (current.has(contribution.qualifiedId)) continue;
    let subscription: Disposable | null = null;
    try { subscription = contribution.subscribe?.(changed) ?? null; } catch (error) { reportError(error); }
    current.set(contribution.qualifiedId, {
      contribution,
      release: () => {
        try {
          const result = subscription?.dispose();
          if (result instanceof Promise) void result.catch(reportError);
        } catch (error) { reportError(error); }
      },
    });
  }
}

function releaseAll<T>(entries: Map<string, { release: () => void } & T>): void {
  for (const entry of entries.values()) entry.release();
  entries.clear();
}

function isTarget(value: RegisteredPluginContribution): value is TargetProvider {
  return value.kind === "execution-target-provider";
}

function isRun(value: RegisteredPluginContribution): value is RunProvider {
  return value.kind === "run-configuration-provider";
}
