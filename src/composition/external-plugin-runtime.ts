import type {
  Disposable,
  PluginContribution,
  PluginContributionRegistry,
  PluginEvidenceSnapshot,
  PluginWorkspaceIdentity,
} from "../application/plugins/index.ts";
import { adaptSdkContribution } from "../application/plugins/plugin-sdk-adapter.ts";
import type {
  ExternalPluginContribution,
  InstalledPluginActivation,
  InstalledPluginNotificationEvent,
  InstalledPluginRuntimeBridge,
  InstalledPluginRuntimeEvent,
  PluginRuntimeTheme,
  PluginRuntimeValue,
} from "../protocol/plugin-runtime.ts";
import { pluginRuntimeListenerValue } from "../protocol/plugin-runtime.ts";
import type {
  InstalledPlugin,
  PluginMarketplaceBridge,
} from "../protocol/plugin-marketplace.ts";
import type { SdkPluginContribution } from "../../packages/plugin-sdk/index.ts";

const REMOTE_CALLBACK_MARKER = "$asterlynCallback";

export interface ExternalPluginRuntimeOptions {
  readonly registry: PluginContributionRegistry;
  readonly bridge: InstalledPluginRuntimeBridge;
  readonly marketplace: Pick<PluginMarketplaceBridge, "listPluginInstallations">;
  readonly locale: () => string;
  readonly theme?: () => PluginRuntimeTheme;
  readonly reportError: (error: unknown) => void;
  readonly notification?: (event: InstalledPluginNotificationEvent) => void | Promise<void>;
}

interface ActiveExternalPlugin {
  readonly release: Disposable;
  readonly session: ExternalPluginSession;
}

/** Owns isolated installed-plugin sessions and publishes each contribution batch atomically. */
export class ExternalPluginRuntime {
  private readonly options: ExternalPluginRuntimeOptions;
  private readonly active = new Map<string, ActiveExternalPlugin>();
  private releaseEvents: (() => void) | null = null;
  private releaseNotifications: (() => void) | null = null;
  private subscriptionPromise: Promise<void> | null = null;
  private sequence = 0;
  private disposed = false;

  constructor(options: ExternalPluginRuntimeOptions) {
    this.options = options;
  }

  async activate(
    identity: PluginWorkspaceIdentity,
    evidence: PluginEvidenceSnapshot,
    enabled: (pluginId: string) => boolean,
  ): Promise<readonly string[]> {
    const token = ++this.sequence;
    await this.clearActive();
    if (this.disposed || token !== this.sequence) return [];
    await this.ensureSubscriptions();
    const snapshot = await this.options.marketplace.listPluginInstallations();
    if (this.disposed || token !== this.sequence) return [];
    const candidates = snapshot.plugins
      .filter((plugin) => plugin.enabled && enabled(plugin.pluginId) && activatable(plugin))
      .sort((left, right) => left.pluginId.localeCompare(right.pluginId));
    const activated: string[] = [];
    for (const plugin of candidates) {
      if (this.disposed || token !== this.sequence) break;
      await this.activatePlugin(plugin, identity, evidence, token).then((didActivate) => {
        if (didActivate) activated.push(plugin.pluginId);
      }, this.options.reportError);
    }
    return Object.freeze(activated);
  }

  async deactivate(): Promise<void> {
    this.sequence += 1;
    await this.clearActive();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.sequence += 1;
    await this.clearActive();
    this.releaseEvents?.();
    this.releaseEvents = null;
    this.releaseNotifications?.();
    this.releaseNotifications = null;
  }

  private async activatePlugin(
    plugin: InstalledPlugin,
    identity: PluginWorkspaceIdentity,
    evidence: PluginEvidenceSnapshot,
    token: number,
  ): Promise<boolean> {
    let activation: InstalledPluginActivation | null = null;
    let session: ExternalPluginSession | null = null;
    let retained = false;
    try {
      activation = await this.options.bridge.activate(
        plugin.pluginId,
        identity.root,
        identity.generation,
        runtimeEvidence(evidence),
        this.options.locale(),
        this.options.theme?.() ?? "dark",
      );
      if (this.disposed || token !== this.sequence) return false;
      session = new ExternalPluginSession(
        this.options.bridge,
        activation,
        this.options.reportError,
      );
      const contributions = await session.projectContributions();
      if (this.disposed || token !== this.sequence || contributions.length === 0) return false;
      const release = this.options.registry.registerExternalBatch(
        { id: activation.pluginId, version: activation.pluginVersion },
        contributions,
      );
      this.active.set(activation.pluginId, { release, session });
      retained = true;
      return true;
    } finally {
      if (!retained) {
        await session?.dispose();
        await this.options.bridge.deactivate(plugin.pluginId).catch(this.options.reportError);
      }
    }
  }

  private async clearActive(): Promise<void> {
    const entries = [...this.active.entries()].reverse();
    this.active.clear();
    for (const [pluginId, entry] of entries) {
      try { await entry.release.dispose(); } catch (error) { this.options.reportError(error); }
      await entry.session.dispose();
      await this.options.bridge.deactivate(pluginId).catch(this.options.reportError);
    }
  }

  private ensureSubscriptions(): Promise<void> {
    this.subscriptionPromise ??= Promise.all([
      this.options.bridge.subscribe((event) => this.handleEvent(event)),
      this.options.bridge.subscribeNotifications((event) => this.handleNotification(event)),
    ]).then(([releaseEvents, releaseNotifications]) => {
      if (this.disposed) {
        releaseEvents();
        releaseNotifications();
        return;
      }
      this.releaseEvents = releaseEvents;
      this.releaseNotifications = releaseNotifications;
    });
    return this.subscriptionPromise;
  }

  private handleEvent(event: InstalledPluginRuntimeEvent): void {
    this.active.get(event.pluginId)?.session.handleEvent(event);
  }

  private handleNotification(event: InstalledPluginNotificationEvent): void {
    if (!this.active.has(event.pluginId) || !this.options.notification) return;
    Promise.resolve(this.options.notification(event)).catch(this.options.reportError);
  }
}

class ExternalPluginSession {
  private readonly bridge: InstalledPluginRuntimeBridge;
  private readonly activation: InstalledPluginActivation;
  private readonly reportError: (error: unknown) => void;
  private readonly eventHandlers = new Map<string, () => void>();
  private readonly projections: RemoteContributionProjection[] = [];
  private readonly pending = new Set<Promise<unknown>>();
  private subscriptionSequence = 0;
  private closing = false;
  private disposed = false;

  constructor(
    bridge: InstalledPluginRuntimeBridge,
    activation: InstalledPluginActivation,
    reportError: (error: unknown) => void,
  ) {
    this.bridge = bridge;
    this.activation = activation;
    this.reportError = reportError;
  }

  async projectContributions(): Promise<readonly PluginContribution[]> {
    const projected: PluginContribution[] = [];
    for (const contribution of this.activation.contributions) {
      const projection = new RemoteContributionProjection(this, contribution);
      projected.push(await projection.project());
      this.projections.push(projection);
    }
    return Object.freeze(projected);
  }

  invoke(contribution: ExternalPluginContribution, operation: string, arguments_: unknown[]) {
    const handle = contribution.callbacks[operation];
    if (!handle) return Promise.reject(new Error(
      `External contribution callback is unavailable: ${contribution.id}.${operation}`,
    ));
    return this.invokeHandle(handle, operation, arguments_);
  }

  invokeHandle(handle: string, operation: string, arguments_: unknown[]): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error("External plugin session is disposed."));
    const operationPromise = this.bridge.invoke(
      this.activation.pluginId,
      handle,
      operation,
      { arguments: arguments_.map(toRuntimeValue) },
    ).then((value) => this.hydrate(value));
    return this.track(operationPromise);
  }

  subscribe(contribution: ExternalPluginContribution, changed: () => void): Disposable {
    const handle = contribution.callbacks.subscribe;
    if (!handle) return { dispose: () => undefined };
    const subscriptionHandle = `subscription-${++this.subscriptionSequence}`;
    this.eventHandlers.set(subscriptionHandle, changed);
    let remote: Disposable | null = null;
    let released = false;
    const setup = this.invokeHandle(handle, "subscribe", [
      pluginRuntimeListenerValue(subscriptionHandle),
    ]).then((value) => {
      remote = disposable(value);
      if (released) return remote?.dispose();
    }).catch((error) => {
      if (!released) this.reportError(error);
    });
    this.track(Promise.resolve(setup));
    return {
      dispose: () => {
        if (released) return;
        released = true;
        this.eventHandlers.delete(subscriptionHandle);
        try {
          const result = remote?.dispose();
          if (result instanceof Promise) this.track(result.catch(this.reportError));
        } catch (error) {
          this.reportError(error);
        }
      },
    };
  }

  handleEvent(event: InstalledPluginRuntimeEvent): void {
    if (!this.disposed) this.eventHandlers.get(event.subscriptionHandle)?.();
  }

  async dispose(): Promise<void> {
    if (this.disposed || this.closing) return;
    this.closing = true;
    for (const projection of [...this.projections].reverse()) projection.dispose();
    this.projections.splice(0);
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
    this.eventHandlers.clear();
    this.disposed = true;
    this.closing = false;
  }

  private hydrate(value: PluginRuntimeValue): unknown {
    if (Array.isArray(value)) return value.map((item) => this.hydrate(item));
    if (!value || typeof value !== "object") return value;
    const entries = Object.entries(value);
    if (entries.length === 1 && Object.hasOwn(value, REMOTE_CALLBACK_MARKER)) {
      const reference = (value as { readonly $asterlynCallback: {
        readonly handle: string;
        readonly operation: string;
      } }).$asterlynCallback;
      return (...arguments_: unknown[]) => this.invokeHandle(
        reference.handle,
        reference.operation,
        arguments_,
      );
    }
    return Object.fromEntries(entries.map(([key, item]) => [key, this.hydrate(item)]));
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise);
    void promise.finally(() => this.pending.delete(promise)).catch(() => undefined);
    return promise;
  }
}

class RemoteContributionProjection {
  private readonly session: ExternalPluginSession;
  private readonly source: ExternalPluginContribution;
  private readonly listeners = new Set<() => void>();
  private remoteSubscription: Disposable | null = null;
  private snapshot: unknown = null;
  private collections: unknown = null;
  private refreshPromise: Promise<void> | null = null;

  constructor(session: ExternalPluginSession, source: ExternalPluginContribution) {
    this.session = session;
    this.source = source;
  }

  async project(): Promise<PluginContribution> {
    const payload = record(this.source.payload, `contribution ${this.source.id}`);
    switch (this.source.kind) {
      case "command": return this.projectCommand(payload);
      case "taskProvider": return this.projectTaskProvider(payload);
      case "executionTargetProvider": return this.projectExecutionTargetProvider(payload);
      case "runConfigurationProvider": return this.projectRunConfigurationProvider(payload);
    }
  }

  dispose(): void {
    this.listeners.clear();
    try { void this.remoteSubscription?.dispose(); } catch { /* Session shutdown is authoritative. */ }
    this.remoteSubscription = null;
  }

  private async projectCommand(payload: RuntimeRecord): Promise<PluginContribution> {
    const title = await this.readText("title");
    const detail = await this.readText("detail");
    const keywords = this.has("keywords") ? await this.readText("keywords") : null;
    const availability = this.has("availability")
      ? await this.session.invoke(this.source, "availability", [])
      : null;
    return {
      kind: "command",
      id: this.source.id,
      title: () => title,
      detail: () => detail,
      ...(keywords === null ? {} : { keywords: () => keywords }),
      ...(availability === null ? {} : { availability: () => availability as { enabled: boolean; reason?: string } }),
      ...(optionalText(payload.providerId) === null ? {} : { providerId: optionalText(payload.providerId)! }),
      execute: () => this.session.invoke(this.source, "execute", []).then(() => undefined),
    };
  }

  private async projectTaskProvider(payload: RuntimeRecord): Promise<PluginContribution> {
    await this.reload();
    const contribution = {
      kind: "provider" as const,
      id: this.source.id,
      label: requiredText(payload.label, "task provider label"),
      ...(optionalText(payload.settingsFocus) === null
        ? {}
        : { settingsFocus: optionalText(payload.settingsFocus)! }),
      snapshot: () => this.snapshot,
      ...(this.has("collections") ? { collections: () => this.collections } : {}),
      ...(this.has("subscribe") ? { subscribe: (listener: () => void) => this.listen(listener) } : {}),
      ...(this.has("refresh") ? { refresh: () => this.session.invoke(this.source, "refresh", []) } : {}),
      ...(this.has("invalidate") ? { invalidate: (value: unknown) => this.session.invoke(this.source, "invalidate", [value]).then(() => undefined) } : {}),
      ...(this.has("run") ? { run: (taskId: string) => this.session.invoke(this.source, "run", [taskId]) } : {}),
    };
    return adaptSdkContribution(contribution as unknown as SdkPluginContribution);
  }

  private async projectExecutionTargetProvider(_payload: RuntimeRecord): Promise<PluginContribution> {
    await this.reload();
    const contribution = {
      kind: "execution-target-provider" as const,
      id: this.source.id,
      snapshot: () => this.snapshot,
      ...(this.has("subscribe") ? { subscribe: (listener: () => void) => this.listen(listener) } : {}),
      ...(this.has("refresh") ? { refresh: () => this.session.invoke(this.source, "refresh", []).then(() => undefined) } : {}),
      ...(this.has("select") ? { select: (targetId: string | null) => this.session.invoke(this.source, "select", [targetId]).then(() => undefined) } : {}),
    };
    return adaptSdkContribution(contribution as unknown as SdkPluginContribution);
  }

  private async projectRunConfigurationProvider(_payload: RuntimeRecord): Promise<PluginContribution> {
    await this.reload();
    const contribution = {
      kind: "run-configuration-provider" as const,
      id: this.source.id,
      snapshot: () => this.snapshot,
      ...(this.has("subscribe") ? { subscribe: (listener: () => void) => this.listen(listener) } : {}),
      ...(this.has("select") ? { select: (configurationId: string | null) => this.session.invoke(this.source, "select", [configurationId]).then(() => undefined) } : {}),
      ...(this.has("run") ? { run: (configurationId: string, targetId?: string) => this.session.invoke(this.source, "run", [configurationId, targetId]) } : {}),
    };
    return adaptSdkContribution(contribution as unknown as SdkPluginContribution);
  }

  private listen(listener: () => void): Disposable {
    this.listeners.add(listener);
    this.remoteSubscription ??= this.session.subscribe(this.source, () => {
      this.refreshPromise ??= this.reload().then(() => {
        for (const candidate of this.listeners) candidate();
      }).finally(() => { this.refreshPromise = null; });
    });
    let released = false;
    return {
      dispose: () => {
        if (released) return;
        released = true;
        this.listeners.delete(listener);
        if (this.listeners.size === 0) {
          const remote = this.remoteSubscription;
          this.remoteSubscription = null;
          return remote?.dispose();
        }
      },
    };
  }

  private async reload(): Promise<void> {
    this.snapshot = await this.session.invoke(this.source, "snapshot", []);
    if (this.has("collections")) {
      this.collections = await this.session.invoke(this.source, "collections", []);
    }
  }

  private readText(operation: string): Promise<string> {
    return this.session.invoke(this.source, operation, []).then((value) =>
      requiredText(value, `${this.source.id}.${operation}`)
    );
  }

  private has(operation: string): boolean {
    return typeof this.source.callbacks[operation] === "string";
  }
}

type RuntimeRecord = Readonly<Record<string, PluginRuntimeValue>>;

function record(value: PluginRuntimeValue, name: string): RuntimeRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} payload must be an object.`);
  }
  return value as RuntimeRecord;
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 2_048) {
    throw new Error(`${name} must be bounded non-empty text.`);
  }
  return value;
}

function optionalText(value: unknown): string | null {
  return value === undefined || value === null ? null : requiredText(value, "optional text");
}

function activatable(plugin: InstalledPlugin): boolean {
  const version = plugin.pendingVersion ?? plugin.activeVersion;
  if (!version) return false;
  const admitted = plugin.versions.find((candidate) => candidate.version === version);
  return admitted !== undefined && admitted.runtimeStatus !== "quarantined";
}

function runtimeEvidence(evidence: PluginEvidenceSnapshot): PluginRuntimeValue {
  if (evidence.kind === "workspace-catalog") {
    const platform = evidence.platform === "windows" ? "windows" : "posix";
    const files = Array.isArray(evidence.files)
      ? evidence.files.flatMap((file) => file && typeof file === "object" &&
        typeof (file as { workspacePath?: unknown }).workspacePath === "string"
        ? [(file as { workspacePath: string }).workspacePath]
        : [])
      : [];
    return [{
      kind: "workspace-catalog",
      values: { platform, truncated: evidence.truncated === true, files },
    }];
  }
  return Object.entries(evidence).map(([kind, value]) => ({ kind, values: { value: String(value) } }));
}

function toRuntimeValue(value: unknown, depth = 0): PluginRuntimeValue {
  if (depth > 32) throw new Error("External plugin invocation is nested too deeply.");
  if (value === undefined) return null;
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => toRuntimeValue(item, depth + 1));
  if (typeof value !== "object") throw new Error("External plugin invocation must be data only.");
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    toRuntimeValue(item, depth + 1),
  ]));
}

function disposable(value: unknown): Disposable | null {
  if (!value || typeof value !== "object") return null;
  const dispose = (value as { dispose?: unknown }).dispose;
  return typeof dispose === "function" ? { dispose: () => dispose() } : null;
}
