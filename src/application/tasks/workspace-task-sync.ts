import type { PluginWorkspaceIdentity } from "../plugins/plugin-types.ts";

interface SyncPlugin { readonly id: string; readonly version: string; readonly enabled: boolean; readonly active: boolean }
interface SyncProvider { readonly pluginId: string; readonly qualifiedId: string; readonly ready?: boolean }
interface WorkspaceTaskSyncOptions {
  readonly eligiblePlugins: ReadonlySet<string>;
  readonly refresh: (identity: PluginWorkspaceIdentity, providerId: string) => Promise<void>;
  readonly reportError: (error: unknown) => void;
  readonly diagnostic?: (phase: "started" | "settled" | "failed", pluginId: string, providerId: string) => void;
}

/** One attempt per provider/version and workspace session; snapshots never become retry timers. */
export class WorkspaceTaskSync {
  private identity: PluginWorkspaceIdentity | null = null;
  private readonly attempted = new Map<string, { pluginId: string; version: string }>();
  private eligible = new Map<string, { pluginId: string; version: string }>();
  private readonly options: WorkspaceTaskSyncOptions;
  constructor(options: WorkspaceTaskSyncOptions) { this.options = options; }

  activate(identity: PluginWorkspaceIdentity): void {
    if (this.identity?.root === identity.root && this.identity.generation === identity.generation) return;
    this.identity = Object.freeze({ ...identity });
    this.attempted.clear();
    this.eligible.clear();
  }

  reconcile(plugins: readonly SyncPlugin[], providers: readonly SyncProvider[]): void {
    const identity = this.identity;
    if (!identity) return;
    const active = plugins.filter(plugin => plugin.enabled && plugin.active && this.options.eligiblePlugins.has(plugin.id));
    for (const plugin of plugins.filter(plugin => !plugin.enabled)) {
      for (const [id, candidate] of this.attempted) if (candidate.pluginId === plugin.id) this.attempted.delete(id);
    }
    this.eligible = new Map(providers.flatMap(provider => {
      if (provider.ready === false) return [];
      const plugin = active.find(plugin => plugin.id === provider.pluginId);
      return plugin ? [[provider.qualifiedId, { pluginId: plugin.id, version: plugin.version }] as const] : [];
    }));
    for (const [id, plugin] of this.eligible) {
      if (this.attempted.get(id)?.version === plugin.version) continue;
      this.attempted.set(id, plugin);
      void Promise.resolve().then(async () => {
        if (this.identity !== identity || this.attempted.get(id) !== plugin) return;
        if (this.eligible.get(id)?.version !== plugin.version) {
          if (this.attempted.get(id) === plugin) this.attempted.delete(id);
          return;
        }
        this.options.diagnostic?.("started", plugin.pluginId, id);
        try {
          await this.options.refresh(identity, id);
          if (this.identity === identity && this.attempted.get(id) === plugin && this.eligible.get(id)?.version === plugin.version) this.options.diagnostic?.("settled", plugin.pluginId, id);
        } catch (error) {
          if (this.identity === identity && this.attempted.get(id) === plugin && this.eligible.get(id)?.version === plugin.version) {
            this.options.diagnostic?.("failed", plugin.pluginId, id);
            this.options.reportError(error);
          }
        }
      });
    }
  }

  dispose(): void { this.identity = null; this.attempted.clear(); this.eligible.clear(); }
}
