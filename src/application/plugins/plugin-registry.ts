import type {
  BundledPlugin,
  Disposable,
  PluginContribution,
  PluginDiagnostic,
  PluginEvidenceSnapshot,
  PluginActivationContext,
  PluginActivationReport,
  PluginWorkspaceIdentity,
  RegisteredPluginContribution,
} from "./plugin-types.ts";

const IDENTIFIER = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const SETTING_IDENTIFIER = /^[a-z][a-zA-Z0-9]*(?:[.-][a-zA-Z0-9]+)*$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function validatePluginId(id: string): void {
  if (!IDENTIFIER.test(id)) throw new Error(`Invalid plugin ID: ${id}`);
}

export function validateWorkspaceIdentity(identity: PluginWorkspaceIdentity): void {
  if (typeof identity.root !== "string" || identity.root.trim().length === 0) {
    throw new Error("Invalid workspace root");
  }
  if (!Number.isSafeInteger(identity.generation) || identity.generation < 0) {
    throw new Error("Invalid workspace generation");
  }
}

export function validatePluginVersion(version: string): void {
  if (!VERSION.test(version)) throw new Error(`Invalid plugin version: ${version}`);
}

export function validateContributionId(id: string): void {
  if (!IDENTIFIER.test(id)) throw new Error(`Invalid contribution ID: ${id}`);
}

export function qualifyContributionId(pluginId: string, contributionId: string): string {
  validatePluginId(pluginId);
  validateContributionId(contributionId);
  return `${pluginId}.${contributionId}`;
}

export class PluginContributionRegistry {
  private readonly contributions = new Map<string, RegisteredPluginContribution>();
  private readonly listeners = new Set<() => void>();

  register(plugin: BundledPlugin, contribution: PluginContribution): Disposable {
    validatePlugin(plugin);
    validateContribution(contribution);
    const qualifiedId = qualifyContributionId(plugin.id, contribution.id);
    if (this.contributions.has(qualifiedId)) {
      throw new PluginContributionError("duplicate-contribution", `Duplicate contribution ID: ${qualifiedId}`);
    }
    this.contributions.set(qualifiedId, { ...contribution, pluginId: plugin.id, pluginVersion: plugin.version, qualifiedId });
    this.emit();
    let registered = true;
    return {
      dispose: () => {
        if (!registered) return;
        registered = false;
        if (this.contributions.delete(qualifiedId)) this.emit();
      },
    };
  }

  get(qualifiedId: string): RegisteredPluginContribution | null {
    return this.contributions.get(qualifiedId) ?? null;
  }

  list(): readonly RegisteredPluginContribution[] {
    return Array.from(this.contributions.values());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    if (this.contributions.size === 0) return;
    this.contributions.clear();
    this.emit();
  }

  installBatch(entries: readonly StagedContribution[]): void {
    const ids = new Set<string>();
    for (const entry of entries) {
      if (ids.has(entry.qualifiedId) || this.contributions.has(entry.qualifiedId)) {
        throw new PluginContributionError("duplicate-contribution", `Duplicate contribution ID: ${entry.qualifiedId}`);
      }
      ids.add(entry.qualifiedId);
    }
    for (const entry of entries) {
      const value = { ...entry.contribution, pluginId: entry.plugin.id, pluginVersion: entry.plugin.version, qualifiedId: entry.qualifiedId };
      this.contributions.set(entry.qualifiedId, value);
      const handle: Disposable = { dispose: () => {
        if (this.contributions.delete(entry.qualifiedId)) this.emit();
      } };
      entry.handle = handle;
      entry.owner.addCommittedRegistration(handle);
    }
    if (entries.length > 0) this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export class PluginRuntime {
  readonly contributions: PluginContributionRegistry;
  private readonly reportDiagnostic: (diagnostic: PluginDiagnostic) => void;
  private active: Disposable | null = null;
  private transition: Promise<void> = Promise.resolve();
  private sequence = 0;
  private disposed = false;

  constructor(
    contributions = new PluginContributionRegistry(),
    reportDiagnostic: (diagnostic: PluginDiagnostic) => void = () => undefined,
  ) {
    this.contributions = contributions;
    this.reportDiagnostic = reportDiagnostic;
  }

  async activate(
    identity: PluginWorkspaceIdentity,
    evidence: PluginEvidenceSnapshot,
    plugins: readonly BundledPlugin[],
  ): Promise<PluginActivationReport> {
    validateWorkspaceIdentity(identity);
    const activationIdentity = Object.freeze({ root: identity.root, generation: identity.generation });
    if (this.disposed) return { identity: activationIdentity, activated: [], skipped: [], diagnostics: [] };
    const pluginIds = new Set<string>();
    for (const plugin of plugins) {
      validatePlugin(plugin);
      if (pluginIds.has(plugin.id)) throw new Error(`Duplicate plugin ID: ${plugin.id}`);
      pluginIds.add(plugin.id);
    }
    const snapshot = cloneAndFreezeEvidence(evidence);
    const token = ++this.sequence;
    const operation = this.transition.then(() => this.activateSerialized(
      activationIdentity,
      snapshot,
      plugins,
      token,
    ));
    this.transition = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async activateSerialized(
    identity: PluginWorkspaceIdentity,
    snapshot: PluginEvidenceSnapshot,
    plugins: readonly BundledPlugin[],
    token: number,
  ): Promise<PluginActivationReport> {
    const previous = this.active;
    this.active = null;
    await previous?.dispose();

    const batch = new ActivationBatch(this.contributions);

    const activated: string[] = [];
    const skipped: string[] = [];
    const diagnostics: PluginDiagnostic[] = [];
    const scopes: ActivationScope[] = [];
    for (const plugin of plugins) {
      let matches = false;
      try {
        matches = plugin.matches({ identity, evidence: snapshot });
      } catch (error) {
        const diagnostic = diagnosticFor(plugin.id, "activation-failed", error);
        diagnostics.push(diagnostic);
        reportSafely(this.reportDiagnostic, diagnostic);
        continue;
      }
      if (!matches) {
        skipped.push(plugin.id);
        continue;
      }
      if (token !== this.sequence || this.disposed) {
        skipped.push(plugin.id);
        continue;
      }
      const scope = new ActivationScope(batch, plugin, { identity, evidence: snapshot });
      try {
        const returned = await plugin.activate(scope.context);
        if (token !== this.sequence || this.disposed) {
          await scope.dispose(returned);
          continue;
        }
        scope.adopt(returned);
        scopes.push(scope);
        activated.push(plugin.id);
      } catch (error) {
        await scope.dispose();
        const diagnostic = diagnosticFor(plugin.id, "activation-failed", error);
        diagnostics.push(diagnostic);
        reportSafely(this.reportDiagnostic, diagnostic);
      }
    }
    if (token === this.sequence && !this.disposed) {
      try {
        batch.commit();
        this.active = new CompositeActivation(scopes);
      } catch (error) {
        await new CompositeActivation(scopes).dispose();
        activated.splice(0);
        const diagnostic = diagnosticFor("host", "activation-failed", error);
        diagnostics.push(diagnostic);
        reportSafely(this.reportDiagnostic, diagnostic);
      }
    } else {
      await new CompositeActivation(scopes).dispose();
    }
    return { identity, activated, skipped, diagnostics };
  }

  async deactivate(): Promise<void> {
    if (this.disposed) return;
    this.sequence += 1;
    const operation = this.transition.then(async () => {
      const active = this.active;
      this.active = null;
      await active?.dispose();
    });
    this.transition = operation.then(() => undefined, () => undefined);
    await operation;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.sequence += 1;
    const operation = this.transition.then(async () => {
      const active = this.active;
      this.active = null;
      await active?.dispose();
    });
    this.transition = operation.then(() => undefined, () => undefined);
    await operation;
  }
}

export const PluginHost = PluginRuntime;
export const PluginRegistry = PluginContributionRegistry;

class PluginContributionError extends Error {
  readonly kind: "invalid-contribution" | "duplicate-contribution";
  constructor(kind: "invalid-contribution" | "duplicate-contribution", message: string) {
    super(message);
    this.kind = kind;
    this.name = "PluginContributionError";
  }
}

interface StagedContribution {
  readonly plugin: BundledPlugin;
  readonly contribution: PluginContribution;
  readonly qualifiedId: string;
  readonly owner: ActivationScope;
  handle?: Disposable;
}

class ActivationBatch {
  private readonly staged = new Map<string, StagedContribution>();
  private committed = false;
  private readonly registry: PluginContributionRegistry;

  constructor(registry: PluginContributionRegistry) { this.registry = registry; }

  stage(plugin: BundledPlugin, contribution: PluginContribution, owner: ActivationScope): StagedContribution {
    validateContribution(contribution);
    const qualifiedId = qualifyContributionId(plugin.id, contribution.id);
    if (this.staged.has(qualifiedId) || this.registry.get(qualifiedId) !== null) {
      throw new PluginContributionError("duplicate-contribution", `Duplicate contribution ID: ${qualifiedId}`);
    }
    const entry = { plugin, contribution, qualifiedId, owner };
    this.staged.set(qualifiedId, entry);
    return entry;
  }

  remove(entry: StagedContribution): void {
    if (!this.committed) this.staged.delete(entry.qualifiedId);
  }

  removeOwner(owner: ActivationScope): void {
    if (this.committed) return;
    for (const [id, entry] of this.staged) if (entry.owner === owner) this.staged.delete(id);
  }

  commit(): void {
    if (this.committed) return;
    const entries = Array.from(this.staged.values());
    this.registry.installBatch(entries);
    this.committed = true;
  }
}

class ActivationScope {
  readonly context: PluginActivationContext;
  private readonly registrations: Disposable[] = [];
  private adopted: Disposable | null = null;
  private released = false;
  private readonly batch: ActivationBatch;
  private readonly plugin: BundledPlugin;
  readonly source: { readonly identity: PluginWorkspaceIdentity; readonly evidence: PluginEvidenceSnapshot };

  constructor(
    batch: ActivationBatch,
    plugin: BundledPlugin,
    source: { readonly identity: PluginWorkspaceIdentity; readonly evidence: PluginEvidenceSnapshot },
  ) {
    this.batch = batch;
    this.plugin = plugin;
    this.source = source;
    this.context = {
      identity: source.identity,
      evidence: source.evidence,
      contribute: (contribution) => {
        const staged = this.batch.stage(this.plugin, contribution, this);
        return {
          dispose: () => {
            if (this.released) return;
            if (staged.handle) void staged.handle.dispose();
            else this.batch.remove(staged);
          },
        };
      },
    };
  }

  adopt(returned: void | Disposable): void {
    this.adopted = returned ?? null;
  }

  async dispose(returned?: void | Disposable): Promise<void> {
    if (this.released) return;
    this.released = true;
    const disposable = returned ?? this.adopted;
    try {
      await disposable?.dispose();
    } catch {
      // A plugin cannot prevent the host from releasing its registrations.
    } finally {
      for (const registration of this.registrations.splice(0).reverse()) {
        try { await registration.dispose(); } catch { /* registration release is best effort */ }
      }
      this.batch.removeOwner(this);
    }
  }

  addCommittedRegistration(registration: Disposable): void { this.registrations.push(registration); }
}

class CompositeActivation implements Disposable {
  private done = false;
  private readonly scopes: readonly ActivationScope[];
  constructor(scopes: readonly ActivationScope[]) { this.scopes = scopes; }
  async dispose(): Promise<void> {
    if (this.done) return;
    this.done = true;
    for (const scope of [...this.scopes].reverse()) await scope.dispose();
  }
}

function validatePlugin(plugin: BundledPlugin): void {
  validatePluginId(plugin.id);
  validatePluginVersion(plugin.version);
  if (plugin.manifest.id !== plugin.id || plugin.manifest.version !== plugin.version ||
    !plugin.manifest.nameKey.trim() || !plugin.manifest.descriptionKey.trim() ||
    !Array.isArray(plugin.manifest.settings)) {
    throw new Error(`Invalid plugin manifest: ${plugin.id}`);
  }
  const settingIds = new Set<string>();
  for (const setting of plugin.manifest.settings) {
    if (!SETTING_IDENTIFIER.test(setting.id) || settingIds.has(setting.id) ||
      !setting.labelKey.trim() || (setting.descriptionKey !== undefined && !setting.descriptionKey.trim()) ||
      (setting.kind !== "enum" && setting.kind !== "boolean")) {
      throw new Error(`Invalid plugin setting: ${plugin.id}.${setting.id}`);
    }
    settingIds.add(setting.id);
    if (setting.kind === "enum" &&
      (!Array.isArray(setting.options) || setting.options.length === 0 ||
        typeof setting.defaultValue !== "string" ||
        !setting.options.some((option: { readonly value: string }) => option.value === setting.defaultValue))) {
      throw new Error(`Invalid plugin setting options: ${plugin.id}.${setting.id}`);
    }
    if (setting.kind === "boolean" && typeof setting.defaultValue !== "boolean") {
      throw new Error(`Invalid plugin setting default: ${plugin.id}.${setting.id}`);
    }
  }
  if (typeof plugin.matches !== "function" || typeof plugin.activate !== "function" ||
    (plugin.evidenceKey !== undefined && typeof plugin.evidenceKey !== "function")) {
    throw new Error(`Invalid plugin descriptor: ${plugin.id}`);
  }
}

function validateContribution(contribution: PluginContribution): void {
  try {
    validateContributionId(contribution.id);
    if (contribution.kind === "command" &&
      (typeof contribution.title !== "function" || typeof contribution.detail !== "function" ||
        typeof contribution.execute !== "function" ||
        (contribution.keywords !== undefined && typeof contribution.keywords !== "function") ||
        (contribution.availability !== undefined && typeof contribution.availability !== "function") ||
        (contribution.providerId !== undefined && (!IDENTIFIER.test(contribution.providerId) || contribution.providerId.trim().length === 0)))) {
      throw new Error(`Invalid command contribution: ${contribution.id}`);
    }
    if (contribution.kind === "provider" &&
      (!contribution.label.trim() || typeof contribution.snapshot !== "function" ||
        (contribution.settingsFocus !== undefined && !SETTING_IDENTIFIER.test(contribution.settingsFocus)) ||
        (contribution.subscribe !== undefined && typeof contribution.subscribe !== "function") ||
        (contribution.refresh !== undefined && typeof contribution.refresh !== "function") ||
        (contribution.run !== undefined && typeof contribution.run !== "function"))) {
      throw new Error(`Invalid provider contribution: ${contribution.id}`);
    }
  } catch (error) {
    if (error instanceof PluginContributionError) throw error;
    throw new PluginContributionError("invalid-contribution", error instanceof Error ? error.message : String(error));
  }
}

function diagnosticFor(pluginId: string, kind: PluginDiagnostic["kind"], error: unknown): PluginDiagnostic {
  const actualKind = error instanceof PluginContributionError ? error.kind : kind;
  return { kind: actualKind, pluginId, message: error instanceof Error ? error.message : String(error), error };
}

function reportSafely(report: (diagnostic: PluginDiagnostic) => void, diagnostic: PluginDiagnostic): void {
  try { report(diagnostic); } catch { /* diagnostics are observers and cannot break activation */ }
}

function cloneAndFreezeEvidence(evidence: PluginEvidenceSnapshot): PluginEvidenceSnapshot {
  const snapshot = structuredClone(evidence) as PluginEvidenceSnapshot;
  const pending: object[] = [snapshot];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (!value || visited.has(value)) continue;
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
      throw new Error("Plugin evidence must contain only plain objects and arrays");
    }
    visited.add(value);
    for (const nested of Object.values(value)) {
      if (typeof nested === "object" && nested !== null) pending.push(nested);
    }
    Object.freeze(value);
  }
  return snapshot;
}
