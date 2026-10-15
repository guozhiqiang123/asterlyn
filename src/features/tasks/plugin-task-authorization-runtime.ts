import type {
  PluginManagementEntry,
  PluginManagementSnapshot,
  PluginWorkspaceIdentity,
} from "../../application/plugins/plugin-types.ts";
import type { TaskExecutionBridge } from "../../protocol/task-execution.ts";
import type { TaskConfirmationPresentation } from "./task-execution-view.ts";

type WorkspaceTrustPresentation = "loading" | "unknown" | "trusted" | "denied" | "error";

/** Keeps plugin-owned authorization copy/state behind the host task execution boundary. */
export class PluginTaskAuthorizationRuntime {
  private readonly workspaceTrust = new Map<string, WorkspaceTrustPresentation>();
  private readonly bridge: TaskExecutionBridge;
  private readonly locale: () => "en-US" | "zh-CN";
  private readonly reportError: (error: unknown) => void;
  private identity: PluginWorkspaceIdentity | null = null;

  constructor(
    bridge: TaskExecutionBridge,
    locale: () => "en-US" | "zh-CN",
    reportError: (error: unknown) => void,
  ) {
    this.bridge = bridge;
    this.locale = locale;
    this.reportError = reportError;
  }

  activate(identity: PluginWorkspaceIdentity): void {
    this.identity = Object.freeze({ root: identity.root, generation: identity.generation });
    this.workspaceTrust.clear();
  }

  async load(snapshot: PluginManagementSnapshot): Promise<void> {
    const identity = this.identity;
    if (!identity) {
      this.workspaceTrust.clear();
      return;
    }
    const pluginIds = snapshot.entries
      .filter((entry) => entry.taskAuthorization !== undefined)
      .map((entry) => entry.id);
    for (const pluginId of pluginIds) this.workspaceTrust.set(pluginId, "loading");
    await Promise.all(pluginIds.map(async (pluginId) => {
      try {
        const result = await this.bridge.readWorkspaceTrust(identity.root, pluginId);
        if (!this.matches(identity) || result.workspaceRoot !== identity.root || result.pluginId !== pluginId) return;
        this.workspaceTrust.set(pluginId, result.state);
      } catch (error) {
        if (this.matches(identity)) this.workspaceTrust.set(pluginId, "error");
        this.reportError(error);
      }
    }));
  }

  async set(snapshot: PluginManagementSnapshot, pluginId: string, trusted: boolean): Promise<boolean> {
    const identity = this.identity;
    const entry = snapshot.entries.find((candidate) => candidate.id === pluginId);
    if (!identity || !entry?.taskAuthorization) return false;
    const requested = trusted ? "trusted" : "denied";
    if (this.workspaceTrust.get(pluginId) === requested) return false;
    this.workspaceTrust.set(pluginId, "loading");
    try {
      const result = await this.bridge.setWorkspaceTrust(identity.root, pluginId, requested);
      if (!this.matches(identity) || result.workspaceRoot !== identity.root ||
        result.pluginId !== pluginId || result.state !== requested) {
        throw new Error("Plugin workspace trust response is stale.");
      }
      this.workspaceTrust.set(pluginId, result.state);
      return true;
    } catch (error) {
      if (this.matches(identity)) this.workspaceTrust.set(pluginId, "error");
      throw error;
    }
  }

  project(snapshot: PluginManagementSnapshot): PluginManagementSnapshot {
    return Object.freeze({
      schemaVersion: 1,
      entries: Object.freeze(snapshot.entries.map((entry) => entry.taskAuthorization === undefined
        ? entry
        : Object.freeze({
            ...entry,
            workspaceTrust: this.identity
              ? (this.workspaceTrust.get(entry.id) ?? "loading")
              : "unavailable",
          }))),
    });
  }

  taskConfirmation(
    snapshot: PluginManagementSnapshot,
    pluginId: string,
  ): TaskConfirmationPresentation | null {
    const entry = snapshot.entries.find((candidate) => candidate.id === pluginId);
    const descriptor = entry?.taskAuthorization?.taskConfirmation;
    if (!entry || !descriptor) return null;
    return {
      label: pluginMessage(entry, this.locale(), descriptor.rememberLabelKey),
      ...(descriptor.rememberDescriptionKey === undefined
        ? {}
        : { description: pluginMessage(entry, this.locale(), descriptor.rememberDescriptionKey) }),
    };
  }

  private matches(identity: PluginWorkspaceIdentity): boolean {
    return this.identity?.root === identity.root && this.identity.generation === identity.generation;
  }
}

function pluginMessage(entry: PluginManagementEntry, locale: string, key: string): string {
  return entry.localization.locales[locale]?.[key] ??
    entry.localization.locales[entry.localization.defaultLocale]?.[key] ?? key;
}
