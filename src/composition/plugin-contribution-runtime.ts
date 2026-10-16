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
  PluginTaskRunPlan,
  PluginWorkspaceInvalidation,
  PluginWorkspaceIdentity,
  PluginSettingsTarget,
  PluginSettingsTargetResolution,
  RegisteredPluginContribution,
} from "../application/plugins/index.ts";
import type { TaskProviderSnapshot } from "../application/tasks/index.ts";
import type { TaskRunState } from "../application/tasks/index.ts";
import type { TaskProviderProjection } from "../features/tasks/index.ts";
import type { TaskProviderCollection } from "../features/tasks/tasks-model.ts";
import { normalizeHierarchicalCollection } from "../application/plugins/plugin-collection-adapter.ts";
import { validTaskArtifactHints, validTaskArtifactSidecarNames } from "../protocol/task-artifacts.ts";

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
  readonly executeTaskRun?: (
    identity: PluginWorkspaceIdentity,
    plan: PluginTaskRunPlan,
    signal: AbortSignal,
    progressChanged: (status: Extract<TaskRunState, "queued" | "running">) => void,
  ) => Promise<PluginTaskExecutionResult>;
  readonly providerRefreshTitle?: (providerLabel: string) => string;
  readonly mutationBlocked?: () => boolean;
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
  private runInFlight: Promise<void> | null = null;
  private activeRun: { readonly providerQualifiedId: string; readonly taskId: string; readonly status: Extract<TaskRunState, "queued" | "running"> } | null = null;

  constructor(
    registry: PluginContributionRegistry,
    options: PluginContributionRuntimeOptions,
  ) {
    this.registry = registry;
    this.options = options;
    this.releaseRegistry = registry.subscribe(() => this.reconcile());
  }

  /** Resolves settings owners from currently active provider contributions. */
  pluginSettingsTargets(): PluginSettingsTargetResolution {
    const targets = [...new Map([...this.providers.values()]
      .map(({ contribution }): PluginSettingsTarget | null => contribution.settingsFocus === undefined ? null : {
        pluginId: contribution.pluginId,
        focus: contribution.settingsFocus,
      })
      .filter((target): target is PluginSettingsTarget => target !== null)
      .map((target) => [`${target.pluginId}.${target.focus ?? ""}`, target] as const)).values()]
      .sort((left, right) => `${left.pluginId}.${left.focus ?? ""}`.localeCompare(`${right.pluginId}.${right.focus ?? ""}`));
    if (targets.length === 0) return null;
    if (targets.length === 1) return targets[0] ?? null;
    return targets;
  }

  activateWorkspace(identity: PluginWorkspaceIdentity): void {
    if (this.disposed) return;
    this.abortRefresh();
    this.identity = Object.freeze({ root: identity.root, generation: identity.generation });
    this.refreshInFlight = null;
    this.runInFlight = null;
    this.activeRun = null;
    this.options.replaceProviders(this.identity, []);
  }

  async refreshProviders(identity: PluginWorkspaceIdentity, providerQualifiedId?: string): Promise<void> {
    if (!this.matches(identity)) return;
    if (this.runInFlight || this.options.mutationBlocked?.()) throw new PluginTaskBusyError();
    if (this.refreshInFlight) return this.refreshInFlight;
    const operation = this.refreshProvidersSerialized(identity, providerQualifiedId);
    this.refreshInFlight = operation;
    void operation.then(
      () => { if (this.refreshInFlight === operation) this.refreshInFlight = null; },
      () => { if (this.refreshInFlight === operation) this.refreshInFlight = null; },
    );
    return this.refreshInFlight;
  }

  async runTask(taskKey: string, identity: PluginWorkspaceIdentity): Promise<void> {
    if (!this.matches(identity)) return;
    if (this.refreshInFlight || this.runInFlight || this.options.mutationBlocked?.()) throw new PluginTaskBusyError();
    const [providerQualifiedId, ...taskParts] = taskKey.split(":");
    const taskId = taskParts.join(":");
    if (!providerQualifiedId) throw new Error(`Task is not runnable: ${taskKey}`);
    const entry = this.providers.get(providerQualifiedId);
    const contribution = entry?.contribution;
    if (!contribution?.run || !taskId) throw new Error(`Task is not runnable: ${taskKey}`);
    const snapshot = snapshotSafely(contribution, this.options.reportError);
    const task = snapshot.status === "ready" ? snapshot.tasks.find((candidate) => candidate.id === taskId) : null;
    if (!task || !task.runnable) throw new Error(`Task is not runnable: ${taskKey}`);
    const operation = this.runTaskSerialized(identity, contribution, taskId);
    this.runInFlight = operation;
    void operation.then(
      () => { if (this.runInFlight === operation) this.runInFlight = null; },
      () => { if (this.runInFlight === operation) this.runInFlight = null; },
    );
    return operation;
  }

  cancelTask(identity: PluginWorkspaceIdentity): void {
    if (!this.matches(identity)) return;
    this.refreshAbort?.abort();
  }

  async invalidateWorkspace(
    identity: PluginWorkspaceIdentity,
    invalidation: PluginWorkspaceInvalidation,
  ): Promise<void> {
    if (!this.matches(identity) || this.disposed) return;
    const value = Object.freeze({
      paths: Object.freeze([...invalidation.paths]),
      recovery: invalidation.recovery,
    });
    const pending: Promise<void>[] = [];
    for (const { contribution } of this.providers.values()) {
      if (!contribution.invalidate) continue;
      try {
        const result = contribution.invalidate(value);
        if (result) pending.push(Promise.resolve(result).catch(this.options.reportError));
      } catch (error) {
        this.options.reportError(error);
      }
    }
    this.publishProviders();
    await Promise.all(pending);
    if (this.matches(identity)) this.publishProviders();
  }

  private async runTaskSerialized(identity: PluginWorkspaceIdentity, contribution: RegisteredProvider, taskId: string): Promise<void> {
    if (!this.options.executeTaskRun) throw new Error("Task execution is unavailable");
    const plan = await contribution.run?.(taskId);
    if (!this.matches(identity)) return;
    if (!plan || !validTaskPlan(plan, contribution, taskId)) throw new Error(`Invalid task execution plan from ${contribution.qualifiedId}`);
    this.publishProviders();
    const abort = new AbortController();
    this.refreshAbort = abort;
    this.activeRun = { providerQualifiedId: contribution.qualifiedId, taskId, status: "queued" };
    this.publishProviders();
    try {
      const result = await this.options.executeTaskRun(identity, plan, abort.signal, (status) => {
        if (!this.matches(identity) || this.activeRun?.providerQualifiedId !== contribution.qualifiedId || this.activeRun.taskId !== taskId || this.activeRun.status === status) return;
        this.activeRun = { ...this.activeRun, status };
        this.publishProviders();
      });
      if (this.matches(identity) && this.providers.get(contribution.qualifiedId)?.contribution === contribution) {
        plan.apply(result);
        this.activeRun = null;
        this.publishProviders();
      }
    } finally {
      if (this.activeRun?.providerQualifiedId === contribution.qualifiedId && this.activeRun.taskId === taskId) {
        this.activeRun = null;
        this.publishProviders();
      }
      if (this.refreshAbort === abort) this.refreshAbort = null;
    }
  }
  private async refreshProvidersSerialized(identity: PluginWorkspaceIdentity, providerQualifiedId?: string): Promise<void> {
    for (const { contribution } of this.providers.values()) {
      if (providerQualifiedId && contribution.qualifiedId !== providerQualifiedId) continue;
      if (!contribution.refresh) continue;
      let plan: PluginTaskRefreshPlan | null = null;
      try {
        plan = await contribution.refresh() ?? null;
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
      } catch (error) {
        this.options.reportError(error);
        if (plan && this.matches(identity) && this.providers.get(contribution.qualifiedId)?.contribution === contribution) {
          try {
            plan.apply({
              status: "crashed",
              outputs: [],
              truncated: false,
              error: error instanceof Error ? error.message : String(error),
            });
          } catch (applyError) { this.options.reportError(applyError); }
        }
      }
    }
    this.publishProviders();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortRefresh();
    this.runInFlight = null;
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
      .map(({ contribution }) => {
        const snapshot = overlayActiveRun(
          snapshotSafely(contribution, this.options.reportError),
          contribution.qualifiedId,
          this.activeRun,
        );
        const collection = collectionSafely(contribution, this.options.reportError);
        return {
          id: contribution.qualifiedId,
          label: contribution.label,
          snapshot,
          ...(collection ? { collection } : {}),
        };
      })
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

function overlayActiveRun(
  snapshot: TaskProviderSnapshot,
  providerQualifiedId: string,
  activeRun: { readonly providerQualifiedId: string; readonly taskId: string; readonly status: Extract<TaskRunState, "queued" | "running"> } | null,
): TaskProviderSnapshot {
  if (!activeRun || activeRun.providerQualifiedId !== providerQualifiedId) return snapshot;
  return {
    ...snapshot,
    tasks: snapshot.tasks.map((task) => task.id === activeRun.taskId ? { ...task, runState: activeRun.status } : task),
  };
}

function collectionSafely(
  contribution: RegisteredProvider,
  reportError: (error: unknown) => void,
): TaskProviderCollection | undefined {
  if (!contribution.collections) return undefined;
  try {
    const candidates = contribution.collections();
    if (!Array.isArray(candidates)) throw new Error(`Invalid collection list from ${contribution.qualifiedId}`);
    if (candidates.length === 0) return undefined;
    const matches = candidates.filter((candidate) => candidate?.providerId === contribution.id);
    if (matches.length !== 1) {
      throw new Error(`Expected one collection for provider ${contribution.id}; received ${matches.length}`);
    }
    const normalized = normalizeHierarchicalCollection(matches[0]!);
    const prefix = `${contribution.qualifiedId}:collection:`;
    const qualify = (id: string): string => `${prefix}${encodeURIComponent(id)}`;
    return {
      providerId: contribution.qualifiedId,
      nodes: normalized.nodes.map((node) => ({
        ...node,
        id: qualify(node.id),
        parentId: node.parentId === null ? null : qualify(node.parentId),
      })),
      truncated: normalized.truncated,
      source: "contributed",
    };
  } catch (error) {
    reportError(error);
    return undefined;
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

function validTaskPlan(plan: PluginTaskRunPlan, contribution: RegisteredProvider, taskId: string): boolean {
  return validRefreshPlan(plan, contribution) && plan.request.taskId === taskId &&
    (plan.artifactSearch === undefined || (
      typeof plan.artifactSearch === "object" && plan.artifactSearch !== null &&
      validTaskArtifactHints(plan.artifactSearch.hints) &&
      (plan.artifactSearch.sidecarNames === undefined || validTaskArtifactSidecarNames(plan.artifactSearch.sidecarNames))
    ));
}

export class PluginTaskBusyError extends Error {
  readonly code = "busy" as const;
  constructor() { super("Task execution is already busy for this workspace."); this.name = "PluginTaskBusyError"; }
}
