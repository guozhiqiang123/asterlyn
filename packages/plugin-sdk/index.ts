/**
 * @asterlyn/plugin-sdk is a pure, declarative first-party contract package.
 * It intentionally has no imports from the host, Tauri, DOM, filesystem, or process APIs.
 */

export const PLUGIN_SDK_VERSION = "1.6.0" as const;
export const PLUGIN_SDK_MAJOR = 1 as const;

export const SDK_PLUGIN_LOCALIZATION_LIMITS = Object.freeze({
  maxLocales: 16,
  maxLocaleLength: 35,
  maxMessagesPerLocale: 512,
  maxKeyLength: 128,
  maxValueLength: 4_096,
  maxTotalCharacters: 262_144,
});

export const SDK_PLUGIN_NOTIFICATION_LIMITS = Object.freeze({
  maxMessageKeyLength: 128,
  maxResolvedMessageLength: 512,
});

export const SDK_PLUGIN_WORKSPACE_TOOL_LIMITS = Object.freeze({
  maxIdLength: 128,
  maxTitleKeyLength: 128,
  maxViews: 16,
  maxViewIdLength: 128,
  maxViewLabelKeyLength: 128,
});

export const SDK_PLUGIN_PROCESS_QUERY_LIMITS = Object.freeze({
  maxQueries: 32,
  maxIdLength: 128,
  maxArguments: 64,
  maxArgumentLength: 1_024,
  maxTimeoutMs: 60_000,
  maxOutputBytes: 1_048_576,
  maxEnvironmentVariableLength: 128,
  maxRelativePathLength: 512,
  maxWorkspacePropertyPathLength: 256,
  maxWorkspacePropertyKeyLength: 128,
  maxPathNameLength: 128,
});

export const SDK_PLUGIN_TOOL_OPERATION_LIMITS = Object.freeze({
  maxOperations: 32,
  maxIdLength: 128,
  maxArguments: 64,
  maxArgumentLength: 1_024,
  maxParameters: 16,
  maxParameterNameLength: 128,
  maxParameterValueLength: 4_096,
  maxTimeoutMs: 300_000,
  maxOutputBytes: 1_048_576,
  maxArtifactSuffixLength: 32,
});

export const SDK_PLUGIN_EXECUTION_TARGET_LIMITS = Object.freeze({
  maxProviderIdLength: 128,
  maxTargetIdLength: 512,
  maxLabelLength: 512,
  maxDetailLength: 2_048,
  maxTargets: 256,
  maxMetadataEntries: 32,
  maxMetadataKeyLength: 128,
  maxMetadataValueLength: 1_024,
  maxErrorLength: 2_048,
});

export const SDK_PLUGIN_RUN_CONFIGURATION_LIMITS = Object.freeze({
  maxProviderIdLength: 128,
  maxConfigurationIdLength: 512,
  maxLabelLength: 512,
  maxDetailLength: 2_048,
  maxConfigurations: 256,
  maxMetadataEntries: 32,
  maxMetadataKeyLength: 128,
  maxMetadataValueLength: 1_024,
  maxErrorLength: 2_048,
});

export type SdkPluginNotificationKind = "info" | "success" | "warning" | "error";

export interface SdkPluginNotificationRequest {
  readonly kind: SdkPluginNotificationKind;
  readonly messageKey: string;
}

/** Optional, host-rendered plain-text notifications bound to the activating plugin. */
export interface SdkPluginNotificationCapability {
  publish(request: SdkPluginNotificationRequest): void;
}

export interface SdkWorkspaceToolViewDescriptor {
  readonly id: string;
  readonly labelKey: string;
}

/** Declarative host-rendered identity for a plugin workbench. */
export interface SdkPluginWorkspaceToolDescriptor {
  readonly id: string;
  readonly titleKey: string;
  readonly icon: "device" | "list" | "puzzle";
  readonly views: readonly SdkWorkspaceToolViewDescriptor[];
  readonly defaultView: string;
}

export type SdkProcessExecutableCandidate =
  | { readonly type: "environment"; readonly variable: string; readonly relativePath: string }
  | { readonly type: "workspaceProperty"; readonly path: string; readonly key: string; readonly relativePath: string }
  | { readonly type: "path"; readonly name: string };

export interface SdkProcessQueryDeclaration {
  readonly id: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly executables: readonly SdkProcessExecutableCandidate[];
}

export type SdkProcessQueryStatus = "succeeded" | "failed" | "timed-out" | "cancelled";

export interface SdkProcessQueryResult {
  readonly status: SdkProcessQueryStatus;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly error: string | null;
}

export interface SdkProcessQueriesCapability {
  execute(queryId: string): Promise<SdkProcessQueryResult>;
}

export type SdkToolOperationIntent = "query" | "mutation";
export type SdkToolOperationParameterKind =
  | "executionTargetId"
  | "androidApplicationId"
  | "androidComponent"
  | "workspaceArtifact";

export interface SdkToolOperationParameterDeclaration {
  readonly name: string;
  readonly kind: SdkToolOperationParameterKind;
  /** Required only for workspaceArtifact parameters. */
  readonly suffixes?: readonly string[];
}

export type SdkToolOperationArgument =
  | { readonly type: "literal"; readonly value: string }
  | { readonly type: "parameter"; readonly name: string };

/** Static package declaration inspected before plugin code runs. */
export interface SdkToolOperationDeclaration {
  readonly id: string;
  readonly intent: SdkToolOperationIntent;
  readonly args: readonly SdkToolOperationArgument[];
  readonly parameters: readonly SdkToolOperationParameterDeclaration[];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly executables: readonly SdkProcessExecutableCandidate[];
}

export interface SdkToolOperationRequest {
  readonly operationId: string;
  readonly parameters: Readonly<Record<string, string>>;
}

export type SdkToolOperationStatus = "succeeded" | "failed" | "timed-out" | "cancelled" | "crashed";

export interface SdkToolOperationResult {
  readonly status: SdkToolOperationStatus;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly exitCode: number | null;
  readonly error: string | null;
}

export interface SdkWorkspaceStateCapability {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
}

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

export interface SdkWorkspaceTrustDescriptor {
  readonly id: string;
  readonly labelKey: string;
  readonly descriptionKey?: string;
}

export interface SdkTaskConfirmationDescriptor {
  readonly rememberLabelKey: string;
  readonly rememberDescriptionKey?: string;
}

/** Plugin-owned policy and copy for host-rendered, host-enforced task authorization. */
export interface SdkTaskAuthorizationDescriptor {
  readonly workspaceTrust: SdkWorkspaceTrustDescriptor;
  readonly taskConfirmation?: SdkTaskConfirmationDescriptor;
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
  readonly taskAuthorization?: SdkTaskAuthorizationDescriptor;
  readonly workspaceTool?: SdkPluginWorkspaceToolDescriptor;
  /** Static, host-admitted external-tool queries. */
  readonly processQueries?: readonly SdkProcessQueryDeclaration[];
  /** Static, typed operations executable only through a host-supervised Run phase. */
  readonly toolOperations?: readonly SdkToolOperationDeclaration[];
}

/** Static package metadata that can be inspected before executable plugin code is loaded. */
export interface SdkPluginPackageManifest extends SdkPluginManifest {
  readonly schemaVersion: 1;
  readonly capabilities: readonly string[];
}

export type SdkExecutionTargetStatus = "online" | "offline" | "unauthorized" | "unknown";
export type SdkExecutionTargetProviderStatus = "loading" | "ready" | "unavailable" | "error";

export interface SdkExecutionTargetDescriptor {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly status: SdkExecutionTargetStatus;
  readonly selectable: boolean;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface SdkExecutionTargetProviderSnapshot {
  readonly status: SdkExecutionTargetProviderStatus;
  readonly targets: readonly SdkExecutionTargetDescriptor[];
  readonly selectedTargetId: string | null;
  readonly error?: string;
}

export interface SdkExecutionTargetProviderContribution {
  readonly kind: "execution-target-provider";
  readonly id: string;
  readonly snapshot: () => SdkExecutionTargetProviderSnapshot;
  readonly subscribe?: (listener: () => void) => SdkDisposable;
  readonly refresh?: () => void | Promise<void>;
  readonly select?: (targetId: string | null) => void | Promise<void>;
}

export type SdkRunConfigurationStatus = "ready" | "incomplete" | "invalid";

export interface SdkRunConfigurationDescriptor {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly status: SdkRunConfigurationStatus;
  readonly targetProviderId?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface SdkRunConfigurationProviderSnapshot {
  readonly status: "loading" | "ready" | "error";
  readonly configurations: readonly SdkRunConfigurationDescriptor[];
  readonly selectedConfigurationId: string | null;
  readonly error?: string;
}

export interface SdkRunConfigurationProviderContribution {
  readonly kind: "run-configuration-provider";
  readonly id: string;
  readonly snapshot: () => SdkRunConfigurationProviderSnapshot;
  readonly subscribe?: (listener: () => void) => SdkDisposable;
  readonly select?: (configurationId: string | null) => void | Promise<void>;
  /** Returns a host-reviewed plan; no process, shell, PTY, or executable handle is exposed. */
  readonly run?: (configurationId: string, targetId?: string) => SdkRunPlan | null | Promise<SdkRunPlan | null>;
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
  readonly artifactSearch?: {
    readonly hints: readonly string[];
    /** Bounded sidecar filenames transported as opaque bytes for plugin-owned parsing. */
    readonly sidecarNames?: readonly string[];
  };
}

export interface SdkRunArtifact {
  readonly workspacePath: string;
  readonly kind: "apk" | "aab";
  readonly byteLength: number;
}

export interface SdkRunArtifactSidecar {
  readonly workspacePath: string;
  readonly byteLength: number;
  readonly dataBase64: string;
}

export type SdkRunSessionPhase =
  | "building"
  | "resolving-artifact"
  | "validating-target"
  | "installing"
  | "launching";

export interface SdkRunSessionResult {
  readonly status: "succeeded" | "failed" | "cancelled" | "crashed";
  readonly phase: SdkRunSessionPhase;
  readonly error: string | null;
}

/**
 * A host-supervised build -> artifact inspection -> exact-target install -> launch plan. Callbacks only transform
 * bounded values into the next reviewed plan; they never receive a process or filesystem handle.
 */
export interface SdkStagedRunPlan {
  readonly kind: "staged";
  /** Current contract. The task builds artifacts but does not install them. */
  readonly build?: SdkTaskRunPlan;
  /** Compatibility alias for SDK 1.5 plugins. New plugins must use build. */
  readonly install?: SdkTaskRunPlan;
  readonly inspect: (
    artifacts: readonly SdkRunArtifact[],
    sidecars: readonly SdkRunArtifactSidecar[],
    truncated: boolean,
  ) => SdkToolOperationRequest | null | Promise<SdkToolOperationRequest | null>;
  /** Optional for SDK 1.5 compatibility; current Android Run plans install before launch. */
  readonly deploy?: (
    inspection: SdkToolOperationResult,
  ) => SdkToolOperationRequest | null | Promise<SdkToolOperationRequest | null>;
  readonly launch: (
    inspection: SdkToolOperationResult,
  ) => SdkToolOperationRequest | null | Promise<SdkToolOperationRequest | null>;
  readonly apply: (result: SdkRunSessionResult) => void;
}

/** The single-task form remains source-compatible while staged Run rolls out. */
export type SdkRunPlan = SdkTaskRunPlan | SdkStagedRunPlan;

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
export type SdkPluginContribution =
  | SdkPluginCommandContribution
  | SdkPluginProviderContribution
  | SdkExecutionTargetProviderContribution
  | SdkRunConfigurationProviderContribution;
export interface SdkPluginActivationContext {
  readonly identity: SdkWorkspaceIdentity;
  readonly evidence: readonly SdkWorkspaceEvidence[];
  readonly taskCache: SdkPluginTaskCacheCapability;
  readonly notifications?: SdkPluginNotificationCapability;
  readonly processQueries?: SdkProcessQueriesCapability;
  readonly workspaceState?: SdkWorkspaceStateCapability;
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
