/**
 * @asterlyn/plugin-sdk is a pure, declarative first-party contract package.
 * It intentionally has no imports from the host, Tauri, DOM, filesystem, or process APIs.
 */

export const PLUGIN_SDK_VERSION = "1.1.0" as const;
export const PLUGIN_SDK_MAJOR = 1 as const;

export const SDK_PLUGIN_LOCALIZATION_LIMITS = Object.freeze({
  maxLocales: 16,
  maxLocaleLength: 35,
  maxMessagesPerLocale: 512,
  maxKeyLength: 128,
  maxValueLength: 4_096,
  maxTotalCharacters: 262_144,
});

export interface SdkWorkspaceIdentity {
  readonly root: string;
  readonly generation: number;
}

export type SdkSettingValue = string | boolean;

export interface SdkSettingOption {
  readonly value: string;
  readonly labelKey: string;
}

export interface SdkSettingDescriptor {
  readonly id: string;
  readonly kind: "enum" | "boolean";
  readonly labelKey: string;
  readonly descriptionKey?: string;
  readonly defaultValue: SdkSettingValue;
  readonly options?: readonly SdkSettingOption[];
}

/** Plain-text, plugin-scoped messages. Hosts validate and render these values. */
export interface SdkPluginLocalization {
  readonly defaultLocale: string;
  readonly locales: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export interface SdkPluginManifest {
  readonly sdkMajor: typeof PLUGIN_SDK_MAJOR;
  readonly id: string;
  readonly version: string;
  readonly nameKey: string;
  readonly descriptionKey: string;
  readonly localization: SdkPluginLocalization;
  readonly settings: readonly SdkSettingDescriptor[];
}

/** Static package metadata that can be inspected before executable plugin code is loaded. */
export interface SdkPluginPackageManifest extends SdkPluginManifest {
  readonly schemaVersion: 1;
  readonly capabilities: readonly string[];
}

export interface SdkCollectionNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly label: string;
  readonly kind: "group" | "task";
  readonly order: number;
  readonly taskId?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export const SDK_COLLECTION_LIMITS = Object.freeze({
  maxNodes: 32_768,
  maxDepth: 64,
  maxIdLength: 512,
  maxLabelLength: 4_096,
  maxMetadataEntries: 16,
  maxMetadataKeyLength: 128,
  maxMetadataValueLength: 1_024,
});

export interface SdkHierarchicalCollection {
  readonly providerId: string;
  readonly nodes: readonly SdkCollectionNode[];
  readonly truncated: boolean;
}

export type SdkTaskProviderStatus = "unavailable" | "loading" | "ready" | "error";
export type SdkTaskProviderCacheStatus = "validating" | "ready" | "stale";
export type SdkTaskProviderStaleReason =
  | "fingerprint-mismatch" | "watcher-change" | "overflow-recovery" | "cache-miss"
  | "cache-expired" | "cache-corrupt" | "refresh-failed" | "fingerprint-unavailable";

export interface SdkTaskProviderCacheMetadata {
  readonly status: SdkTaskProviderCacheStatus;
  readonly staleReason?: SdkTaskProviderStaleReason;
  readonly restoredTaskCount?: number;
}

export type SdkTaskRunState = "idle" | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "crashed";
export type SdkTaskProviderUnavailableReason = "discovery-not-supported" | "evidence-incomplete" | "workspace-untrusted";
export interface SdkTaskDescriptor {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly projectPath?: string;
  readonly description?: string;
  readonly runnable: boolean;
  readonly disabledReason?: string;
  readonly runState?: SdkTaskRunState;
  /** Bounded product-neutral values interpreted only by declared host capabilities. */
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface SdkTaskProviderSnapshot {
  readonly status: SdkTaskProviderStatus;
  readonly tasks: readonly SdkTaskDescriptor[];
  readonly unavailableReason?: SdkTaskProviderUnavailableReason;
  readonly error?: string;
  readonly cache?: SdkTaskProviderCacheMetadata;
}

export interface SdkTaskExecutionRequest {
  readonly pluginId: string;
  readonly providerId: string;
  readonly taskId: string;
  readonly label: string;
  readonly executablePath: string;
  readonly args: string[];
}

export interface SdkTaskExecutionResult {
  readonly status: "succeeded" | "failed" | "cancelled" | "crashed";
  readonly outputs: readonly { readonly stream: "stdout" | "stderr"; readonly dataBase64: string }[];
  readonly truncated: boolean;
  readonly error: string | null;
}

export interface SdkTaskRefreshPlan {
  readonly request: SdkTaskExecutionRequest;
  readonly apply: (result: SdkTaskExecutionResult) => void;
}

export interface SdkTaskRunPlan extends SdkTaskRefreshPlan {
  readonly artifactSearch?: { readonly hints: readonly string[] };
}

export interface SdkWorkspaceInvalidation {
  readonly paths: readonly string[];
  readonly recovery: "none" | "pathsTruncated" | "rootAmbiguous" | "backendOverflow";
}

export type SdkPluginTaskCacheDirtyReason = "workspace-change" | "watcher-ambiguous" | "manual" | "unknown";
export interface SdkWorkspaceFingerprintFile { readonly path: string; readonly status: "present" | "missing"; readonly byteLength: number; readonly digest: string | null; readonly modifiedAtEpochMs: number | null; }
export interface SdkWorkspaceFingerprint { readonly protocolVersion: 1; readonly status: "ready" | "rejected" | "limitExceeded" | "unavailable"; readonly workspaceRoot: string; readonly algorithm: "sha256"; readonly digest: string | null; readonly files: readonly SdkWorkspaceFingerprintFile[]; readonly truncated: boolean; readonly reason: string | null; readonly os: string; readonly arch: string; readonly javaHomeDigest: string | null; }
export interface SdkPluginTaskCacheReadResult { readonly protocolVersion: 1; readonly status: "miss" | "fresh" | "stale" | "dirty" | "corrupt" | "limitExceeded" | "unavailable"; readonly pluginId: string; readonly providerId: string; readonly fingerprint: SdkWorkspaceFingerprint | null; readonly payloadBase64: string | null; readonly updatedAtEpochMs: number | null; readonly lastAccessEpochMs: number | null; readonly staleReason: "expired" | "future-timestamp" | null; readonly dirtyReason: SdkPluginTaskCacheDirtyReason | null; }
export interface SdkPluginTaskCacheMutationResult { readonly protocolVersion: 1; readonly status: "stored" | "rejected" | "limitExceeded" | "dirty" | "unavailable"; readonly pluginId: string | null; readonly providerId: string | null; readonly fingerprint: SdkWorkspaceFingerprint | null; readonly updatedAtEpochMs: number | null; readonly lastAccessEpochMs: number | null; readonly dirtyReason: SdkPluginTaskCacheDirtyReason | null; }

export interface SdkPluginTaskCacheCapability {
  computeFingerprint(paths: readonly string[]): Promise<SdkWorkspaceFingerprint>;
  read(providerId: string): Promise<SdkPluginTaskCacheReadResult>;
  write(providerId: string, fingerprint: SdkWorkspaceFingerprint, payloadBase64: string): Promise<SdkPluginTaskCacheMutationResult>;
  markDirty(providerId: string, reason: SdkPluginTaskCacheDirtyReason): Promise<SdkPluginTaskCacheMutationResult>;
}

export interface SdkDisposable { dispose(): void | Promise<void>; }
export interface SdkPluginCommandContribution {
  readonly kind: "command";
  readonly id: string;
  readonly title: () => string;
  readonly detail: () => string;
  readonly keywords?: () => string;
  readonly availability?: () => { readonly enabled: boolean; readonly reason?: string };
  readonly providerId?: string;
  readonly execute: () => void | Promise<void>;
}
export interface SdkPluginProviderContribution {
  readonly kind: "provider";
  readonly id: string;
  readonly label: string;
  readonly settingsFocus?: string;
  readonly snapshot: () => SdkTaskProviderSnapshot;
  readonly collections?: () => readonly SdkHierarchicalCollection[];
  readonly subscribe?: (listener: () => void) => SdkDisposable;
  readonly refresh?: () => SdkTaskRefreshPlan | null | Promise<SdkTaskRefreshPlan | null>;
  readonly invalidate?: (invalidation: SdkWorkspaceInvalidation) => void | Promise<void>;
  readonly run?: (taskId: string) => SdkTaskRunPlan | null | Promise<SdkTaskRunPlan | null>;
}
export type SdkPluginContribution = SdkPluginCommandContribution | SdkPluginProviderContribution;
export interface SdkPluginActivationContext {
  readonly identity: SdkWorkspaceIdentity;
  readonly evidence: readonly SdkWorkspaceEvidence[];
  readonly taskCache: SdkPluginTaskCacheCapability;
  contribute(contribution: SdkPluginContribution): SdkDisposable;
}
export interface SdkPluginMatchContext { readonly identity: SdkWorkspaceIdentity; readonly evidence: readonly SdkWorkspaceEvidence[]; }

export interface SdkTaskProviderContribution {
  readonly id: string;
  readonly label: string;
  readonly settingsFocus?: string;
  readonly collection: () => SdkHierarchicalCollection;
}

export interface SdkWorkspaceEvidence {
  readonly kind: string;
  readonly values: Readonly<Record<string, string | boolean | number | readonly string[]>>;
}

export interface SdkPluginModule {
  readonly sdkMajor: typeof PLUGIN_SDK_MAJOR;
  readonly id: string;
  readonly version: string;
  readonly manifest: SdkPluginManifest;
  readonly matches: (context: SdkPluginMatchContext) => boolean;
  readonly evidenceKey?: (context: SdkPluginMatchContext) => string;
  readonly activate: (context: SdkPluginActivationContext) => void | SdkDisposable | Promise<void | SdkDisposable>;
}

export type SdkBundledPlugin = SdkPluginModule;
