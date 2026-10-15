import type { TaskProviderSnapshot } from "../tasks/index.ts";
import type {
  PluginTaskCacheDirtyReason,
  PluginTaskCacheMutationResult,
  PluginTaskCacheReadResult,
  WorkspaceFingerprint,
} from "../../protocol/plugin-task-cache.ts";
import type {
  SdkPluginManifest,
  SdkHierarchicalCollection,
  SdkSettingDescriptor,
  SdkSettingOption,
  SdkTaskExecutionRequest,
  SdkTaskExecutionResult,
  SdkTaskRefreshPlan,
  SdkTaskRunPlan,
  SdkWorkspaceInvalidation,
  SdkWorkspaceIdentity,
} from "../../../packages/plugin-sdk/index.ts";

export type PluginWorkspaceIdentity = SdkWorkspaceIdentity;
export type PluginSettingValue = SdkSettingDescriptor["defaultValue"];
export type PluginSettingOption = SdkSettingOption;
export type PluginSettingDescriptor = SdkSettingDescriptor;
export type PluginTaskExecutionResult = SdkTaskExecutionResult;
export type PluginWorkspaceInvalidation = SdkWorkspaceInvalidation;
export type PluginTaskRefreshPlan = SdkTaskRefreshPlan;
export type PluginTaskRunPlan = SdkTaskRunPlan;
export type PluginTaskExecutionRequest = SdkTaskExecutionRequest;

/** A host-owned deep link into a plugin's settings. */
export interface PluginSettingsTarget {
  readonly pluginId: string;
  readonly focus?: string;
}

/** Provider-owned settings targets resolved by the host registry. */
export type PluginSettingsTargetResolution = PluginSettingsTarget | readonly PluginSettingsTarget[] | null;

/** Immutable, host-rendered metadata for a bundled integration. */
/** Host manifest shape during SDK adaptation; plugin localization is admitted separately. */
export type BundledPluginManifest = Omit<SdkPluginManifest, "sdkMajor" | "localization">;

export interface PluginEvidenceSnapshot {
  readonly [key: string]: unknown;
}

export interface PluginWorkspaceCatalogFile {
  readonly workspacePath: string;
}

export interface PluginWorkspaceCatalogEvidence extends PluginEvidenceSnapshot {
  readonly kind: "workspace-catalog";
  readonly platform: "posix" | "windows";
  readonly files: readonly PluginWorkspaceCatalogFile[];
  readonly truncated: boolean;
}

export type PluginDiagnosticKind = "activation-failed" | "invalid-contribution" | "duplicate-contribution";

export interface PluginDiagnostic {
  readonly kind: PluginDiagnosticKind;
  readonly pluginId: string;
  readonly message: string;
  readonly error?: unknown;
}

export interface Disposable {
  dispose(): void | Promise<void>;
}

export interface PluginCommandContribution {
  readonly kind: "command";
  readonly id: string;
  readonly title: () => string;
  readonly detail: () => string;
  readonly keywords?: () => string;
  readonly availability?: () => { readonly enabled: boolean; readonly reason?: string };
  readonly providerId?: string;
  readonly execute: () => void | Promise<void>;
}

export interface PluginProviderContribution {
  readonly kind: "provider";
  readonly id: string;
  readonly label: string;
  /** Stable settings entry ID; pluginId is always supplied by the host. */
  readonly settingsFocus?: string;
  readonly snapshot: () => TaskProviderSnapshot;
  readonly collections?: () => readonly SdkHierarchicalCollection[];
  readonly subscribe?: (listener: () => void) => Disposable;
  readonly refresh?: () => PluginTaskRefreshPlan | null | Promise<PluginTaskRefreshPlan | null>;
  readonly invalidate?: (invalidation: PluginWorkspaceInvalidation) => void | Promise<void>;
  /** Returns a host-reviewed execution plan for a task. Plugins never receive the bridge. */
  readonly run?: (taskId: string) => PluginTaskRunPlan | null | Promise<PluginTaskRunPlan | null>;
}

/** Cache access is bound by the host to one workspace and one plugin. */
export interface PluginTaskCacheCapability {
  computeFingerprint(paths: readonly string[]): Promise<WorkspaceFingerprint>;
  read(providerId: string): Promise<PluginTaskCacheReadResult>;
  write(
    providerId: string,
    fingerprint: WorkspaceFingerprint,
    payloadBase64: string,
  ): Promise<PluginTaskCacheMutationResult>;
  markDirty(
    providerId: string,
    reason: PluginTaskCacheDirtyReason,
  ): Promise<PluginTaskCacheMutationResult>;
}

export interface PluginTaskArtifactSearch {
  readonly hints: readonly string[];
}

/** Execution plans are deliberately the only value a provider may return to the host. */
export type PluginContribution = PluginCommandContribution | PluginProviderContribution;

export interface PluginActivationContext {
  readonly identity: PluginWorkspaceIdentity;
  readonly evidence: PluginEvidenceSnapshot;
  readonly taskCache: PluginTaskCacheCapability;
  contribute(contribution: PluginContribution): Disposable;
}

export interface PluginMatchContext {
  readonly identity: PluginWorkspaceIdentity;
  readonly evidence: PluginEvidenceSnapshot;
}

export interface BundledPlugin {
  readonly id: string;
  readonly version: string;
  readonly manifest: BundledPluginManifest;
  readonly matches: (context: PluginMatchContext) => boolean;
  readonly evidenceKey?: (context: PluginMatchContext) => string;
  readonly activate: (context: PluginActivationContext) => void | Disposable | Promise<void | Disposable>;
}

export type RegisteredPluginContribution = PluginContribution & {
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly qualifiedId: string;
};

export interface PluginActivationReport {
  readonly identity: PluginWorkspaceIdentity;
  readonly activated: readonly string[];
  readonly skipped: readonly string[];
  readonly diagnostics: readonly PluginDiagnostic[];
}

export interface PluginManagementEntry {
  readonly id: string;
  readonly version: string;
  readonly nameKey: string;
  readonly descriptionKey: string;
  readonly enabled: boolean;
  readonly matched: boolean;
  readonly active: boolean;
  readonly settingDescriptors: readonly PluginSettingDescriptor[];
  readonly settings: Readonly<Record<string, PluginSettingValue>>;
  readonly diagnostics: readonly PluginDiagnostic[];
}

export interface PluginManagementSnapshot {
  readonly schemaVersion: 1;
  readonly entries: readonly PluginManagementEntry[];
}
