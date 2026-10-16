import {
  PluginRuntime,
  PluginManagementRuntime,
  PluginPreferenceStore,
  createBrowserPluginPreferenceStorage,
  createBrowserPluginPreferenceSync,
  createSilentPluginPreferenceSync,
  type PluginPreferenceStorage,
  type BundledPlugin,
  type PluginDiagnostic,
  type PluginWorkspaceCatalogEvidence,
  type PluginWorkspaceIdentity,
  type PluginWorkspaceInvalidation,
  type PluginManagementSnapshot,
  type PluginSettingValue,
  type PluginSettingsTargetResolution,
} from "../application/plugins/index.ts";
import type { CommandDescriptor } from "../application/commands/command-service.ts";
import type { TaskProviderProjection } from "../features/tasks/index.ts";
import type { PluginTaskExecutionResult, PluginTaskRefreshPlan, PluginTaskRunPlan } from "../application/plugins/plugin-types.ts";
import type { TaskRunState } from "../application/tasks/index.ts";
import { PluginContributionRuntime } from "./plugin-contribution-runtime.ts";
import type { PluginTaskCacheBridge } from "../protocol/plugin-task-cache.ts";
import { createPluginTaskCacheCapability } from "./plugin-task-cache-capability.ts";
import type { HostNotificationPublisher } from "../application/notifications/index.ts";
import { createPluginNotificationCapability } from "./plugin-notification-capability.ts";
import type { PluginProcessQueryBridge } from "../protocol/plugin-process-query.ts";
import type { PluginWorkspaceStateStorage } from "./plugin-workspace-state-capability.ts";

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
  readonly executeTaskRun?: (
    identity: PluginWorkspaceIdentity,
    plan: PluginTaskRunPlan,
    signal: AbortSignal,
    progressChanged: (status: Extract<TaskRunState, "queued" | "running">) => void,
  ) => Promise<PluginTaskExecutionResult>;
  readonly providerRefreshTitle?: (providerLabel: string) => string;
  readonly loadPlugins?: () => Promise<readonly BundledPlugin[]>;
  readonly preferenceStore?: PluginPreferenceStore;
  readonly taskCacheBridge?: PluginTaskCacheBridge;
  readonly notificationPublisher?: HostNotificationPublisher;
  readonly processQueryBridge?: PluginProcessQueryBridge;
  readonly workspaceStateStorage?: PluginWorkspaceStateStorage;
  readonly locale?: () => string;
  readonly mutationBlocked?: () => boolean;
}

/** Window-scoped orchestration. Bundled plugin code stays behind a lazy project-evidence gate. */
export class PluginCompositionRuntime {
  private readonly runtime: PluginRuntime;
  private readonly contributions: PluginContributionRuntime;
  private readonly loadPlugins: () => Promise<readonly BundledPlugin[]>;
  readonly preferences: PluginPreferenceStore;
  readonly management: PluginManagementRuntime;
  private identity: PluginWorkspaceIdentity | null = null;
  private evidence: PluginWorkspaceCatalogEvidence | null = null;
  private evidenceKey: string | null = null;
  private pluginsPromise: Promise<readonly BundledPlugin[]> | null = null;
  private preferenceTransition: Promise<void> = Promise.resolve();
  private readonly releasePreferences: () => void;
  private disposed = false;

  constructor(options: PluginCompositionRuntimeOptions) {
    this.runtime = new PluginRuntime(
      undefined,
      options.reportDiagnostic,
      (pluginId, identity) => createPluginTaskCacheCapability(
        options.taskCacheBridge,
        identity,
        pluginId,
      ),
      options.notificationPublisher === undefined
        ? undefined
        : (plugin) => createPluginNotificationCapability(
            plugin,
            options.locale ?? (() => "en-US"),
            options.notificationPublisher as HostNotificationPublisher,
          ),
      async (plugin, identity) => (await import("./plugin-process-query-capability.ts"))
        .createPluginProcessQueriesCapability(options.processQueryBridge, plugin, identity),
      async (plugin, identity) => (await import("./plugin-workspace-state-capability.ts"))
        .createPluginWorkspaceStateCapability(options.workspaceStateStorage, plugin, identity),
    );
    this.contributions = new PluginContributionRuntime(this.runtime.contributions, options);
    this.preferences = options.preferenceStore ?? new PluginPreferenceStore(
      defaultPluginPreferenceStorage(),
      [],
      defaultPluginPreferenceSync(),
    );
    this.management = new PluginManagementRuntime(this.preferences);
    this.releasePreferences = this.preferences.subscribe((change) => {
      if (sameEnabledPreferences(change.previous.enabled, change.preferences.enabled)) return;
      this.preferenceTransition = this.preferenceTransition
        .then(() => this.reactivateCurrent(), () => this.reactivateCurrent())
        .catch(options.reportError);
    });
    this.loadPlugins = options.loadPlugins ?? (async () => {
      return (await import("../plugins/bundled-plugins.ts")).loadBundledPlugins(options.reportDiagnostic);
    });
  }

  pluginSettingsTargets(): PluginSettingsTargetResolution {
    return this.contributions.pluginSettingsTargets();
  }

  get contributionRegistry() { return this.runtime.contributions; }

  async activateWorkspace(identity: PluginWorkspaceIdentity): Promise<void> {
    if (this.disposed) return;
    this.identity = Object.freeze({ root: identity.root, generation: identity.generation });
    this.evidence = null;
    this.evidenceKey = null;
    this.contributions.activateWorkspace(this.identity);
    this.management.setMatched([]);
    this.management.setActivation(null);
    await this.runtime.deactivate();
  }

  async updateWorkspaceEvidence(
    identity: PluginWorkspaceIdentity,
    evidence: PluginWorkspaceCatalogEvidence,
  ): Promise<void> {
    if (!this.matches(identity) || this.disposed) return;
    const plugins = await this.bundledPlugins();
    if (!this.matches(identity) || this.disposed) return;
    this.preferences.setManifests(plugins.map((plugin) => plugin.manifest), false);
    this.management.setCatalog(plugins);
    this.evidence = evidence;
    const evidenceKey = pluginEvidenceKey(identity, evidence, plugins);
    if (evidenceKey === this.evidenceKey) return;
    this.management.setMatched(matchingPluginIds(identity, evidence, plugins));
    const enabled = plugins.filter((plugin) => this.preferences.isEnabled(plugin.id));
    const report = await this.runtime.activate(identity, evidence, enabled);
    this.management.setActivation(report);
    if (this.matches(identity) && !this.disposed) this.evidenceKey = evidenceKey;
  }

  async loadManagementCatalog(): Promise<PluginManagementSnapshot> {
    if (this.disposed) return this.management.snapshot;
    const plugins = await this.bundledPlugins();
    if (this.disposed) return this.management.snapshot;
    this.preferences.setManifests(plugins.map((plugin) => plugin.manifest), false);
    this.management.setCatalog(plugins);
    return this.management.snapshot;
  }

  get managementSnapshot(): PluginManagementSnapshot { return this.management.snapshot; }

  async plugin(pluginId: string): Promise<BundledPlugin | null> {
    const plugins = await this.bundledPlugins();
    return plugins.find((plugin) => plugin.id === pluginId) ?? null;
  }

  subscribeManagement(listener: (snapshot: PluginManagementSnapshot) => void): () => void {
    return this.management.subscribe(listener);
  }

  setPluginEnabled(pluginId: string, enabled: boolean): boolean {
    return this.preferences.setEnabled(pluginId, enabled);
  }

  setPluginSetting(pluginId: string, settingId: string, value: PluginSettingValue): boolean {
    return this.preferences.setSetting(pluginId, settingId, value);
  }

  refreshProviders(identity: PluginWorkspaceIdentity): Promise<void> {
    return this.contributions.refreshProviders(identity);
  }

  runTask(taskKey: string, identity: PluginWorkspaceIdentity): Promise<void> {
    return this.contributions.runTask(taskKey, identity);
  }

  cancelTask(identity: PluginWorkspaceIdentity): void {
    this.contributions.cancelTask(identity);
  }

  invalidateWorkspace(
    identity: PluginWorkspaceIdentity,
    invalidation: PluginWorkspaceInvalidation,
  ): Promise<void> {
    return this.contributions.invalidateWorkspace(identity, invalidation);
  }


  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.identity = null;
    this.evidence = null;
    this.evidenceKey = null;
    this.releasePreferences();
    this.management.dispose();
    this.preferences.dispose();
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

  private async reactivateCurrent(): Promise<void> {
    const identity = this.identity;
    const evidence = this.evidence;
    if (!identity || !evidence || this.disposed) return;
    const plugins = await this.bundledPlugins();
    if (!this.matches(identity) || this.disposed) return;
    this.management.setCatalog(plugins);
    this.management.setMatched(matchingPluginIds(identity, evidence, plugins));
    const report = await this.runtime.activate(
      identity,
      evidence,
      plugins.filter((plugin) => this.preferences.isEnabled(plugin.id)),
    );
    if (this.matches(identity) && !this.disposed) {
      this.evidenceKey = pluginEvidenceKey(identity, evidence, plugins);
      this.management.setActivation(report);
    }
  }
}

function matchingPluginIds(
  identity: PluginWorkspaceIdentity,
  evidence: PluginWorkspaceCatalogEvidence,
  plugins: readonly BundledPlugin[],
): readonly string[] {
  return plugins.flatMap((plugin) => {
    try { return plugin.matches({ identity, evidence }) ? [plugin.id] : []; }
    catch { return []; }
  });
}

function sameEnabledPreferences(
  previous: Readonly<Record<string, boolean>>,
  next: Readonly<Record<string, boolean>>,
): boolean {
  const previousIds = Object.keys(previous);
  const nextIds = Object.keys(next);
  if (previousIds.length !== nextIds.length) return false;
  return previousIds.every((id) => previous[id] === next[id]);
}

function defaultPluginPreferenceStorage(): PluginPreferenceStorage {
  if (typeof window !== "undefined") {
    try { return createBrowserPluginPreferenceStorage(window); } catch { /* use memory */ }
  }
  let value: string | null = null;
  return { getItem: () => value, setItem: (_key, next) => { value = next; } };
}

function defaultPluginPreferenceSync() {
  if (typeof window !== "undefined") {
    try { return createBrowserPluginPreferenceSync(window); } catch { /* use silent sync */ }
  }
  return createSilentPluginPreferenceSync();
}

function catalogEvidenceKey(evidence: PluginWorkspaceCatalogEvidence): string {
  return JSON.stringify([
    evidence.platform,
    evidence.truncated,
    evidence.files.map((file) => file.workspacePath).sort(),
  ]);
}

function pluginEvidenceKey(
  identity: PluginWorkspaceIdentity,
  evidence: PluginWorkspaceCatalogEvidence,
  plugins: readonly BundledPlugin[],
): string {
  const fallback = catalogEvidenceKey(evidence);
  return JSON.stringify(plugins.map((plugin) => {
    if (!plugin.evidenceKey) return [plugin.id, fallback];
    try { return [plugin.id, plugin.evidenceKey({ identity, evidence })]; }
    catch { return [plugin.id, fallback]; }
  }));
}
