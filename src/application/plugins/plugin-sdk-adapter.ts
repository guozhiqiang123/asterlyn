import type {
  SdkPluginActivationContext,
  SdkPluginContribution,
  SdkPluginManifest,
  SdkPluginMatchContext,
  SdkPluginModule,
  SdkSettingDescriptor,
  SdkSettingOption,
  SdkTaskAuthorizationDescriptor,
  SdkWorkspaceIdentity,
  SdkPluginWorkspaceToolDescriptor,
  SdkProcessQueryDeclaration,
  SdkToolOperationDeclaration,
  SdkExecutionTargetProviderSnapshot,
  SdkRunConfigurationProviderSnapshot,
} from "../../../packages/plugin-sdk/index.ts";
import {
  SDK_PLUGIN_EXECUTION_TARGET_LIMITS,
  SDK_PLUGIN_RUN_CONFIGURATION_LIMITS,
} from "../../../packages/plugin-sdk/index.ts";
import { validateAndFreezePluginLocalization } from "./plugin-localization.ts";
import type {
  BundledPluginManifest,
  PluginSettingDescriptor,
  PluginSettingOption,
  PluginWorkspaceIdentity,
  BundledPlugin,
  PluginActivationContext,
  PluginMatchContext,
  PluginContribution,
  PluginDiagnostic,
} from "./plugin-types.ts";

export const HOST_PLUGIN_SDK_MAJOR = 1 as const;

export function assertCompatiblePluginSdk(manifest: Pick<SdkPluginManifest, "sdkMajor">): void {
  if (manifest.sdkMajor !== HOST_PLUGIN_SDK_MAJOR) {
    throw new Error(`Unsupported plugin SDK major: ${manifest.sdkMajor}`);
  }
}

export function adaptPluginWorkspaceIdentity(identity: SdkWorkspaceIdentity): PluginWorkspaceIdentity {
  return { root: identity.root, generation: identity.generation };
}

export function adaptPluginManifest(manifest: SdkPluginManifest): BundledPluginManifest {
  assertCompatiblePluginSdk(manifest);
  const localization = validateAndFreezePluginLocalization(manifest);
  return {
    id: manifest.id,
    version: manifest.version,
    nameKey: manifest.nameKey,
    descriptionKey: manifest.descriptionKey,
    localization,
    settings: manifest.settings.map(adaptSetting),
    ...(manifest.taskAuthorization === undefined
      ? {}
      : { taskAuthorization: adaptTaskAuthorization(manifest.taskAuthorization) }),
    ...(manifest.workspaceTool === undefined ? {} : { workspaceTool: adaptWorkspaceTool(manifest.workspaceTool) }),
    ...(manifest.hostOperations === undefined
      ? {}
      : { hostOperations: Object.freeze(manifest.hostOperations.map((operation) => Object.freeze({ id: operation.id }))) }),
    ...(manifest.processQueries === undefined ? {} : { processQueries: adaptProcessQueries(manifest.processQueries) }),
    ...(manifest.toolOperations === undefined ? {} : { toolOperations: adaptToolOperations(manifest.toolOperations) }),
  };
}

function adaptToolOperations(values: readonly SdkToolOperationDeclaration[]): readonly SdkToolOperationDeclaration[] {
  return Object.freeze(values.map((operation) => Object.freeze({
    id: operation.id,
    intent: operation.intent,
    args: Object.freeze(operation.args.map((argument) => Object.freeze({ ...argument }))),
    parameters: Object.freeze(operation.parameters.map((parameter) => Object.freeze({
      name: parameter.name,
      kind: parameter.kind,
      ...(parameter.suffixes === undefined ? {} : { suffixes: Object.freeze([...parameter.suffixes]) }),
    }))),
    timeoutMs: operation.timeoutMs,
    maxOutputBytes: operation.maxOutputBytes,
    executables: Object.freeze(operation.executables.map((candidate) => Object.freeze({ ...candidate }))),
  })));
}

/** Adapts a host-independent SDK module at the single host boundary. */
export function adaptSdkPluginModule(module: SdkPluginModule): BundledPlugin {
  if (module.sdkMajor !== module.manifest.sdkMajor) {
    throw new Error("Plugin SDK major does not match its manifest.");
  }
  if (module.id !== module.manifest.id || module.version !== module.manifest.version) {
    throw new Error("Plugin identity does not match its manifest.");
  }
  assertCompatiblePluginSdk(module.manifest);
  const adaptContext = (context: PluginActivationContext): SdkPluginActivationContext => ({
    identity: adaptPluginWorkspaceIdentity(context.identity),
    evidence: adaptEvidence(context.evidence),
    taskCache: context.taskCache,
    ...(context.notifications === undefined ? {} : { notifications: context.notifications }),
    ...(context.processQueries === undefined ? {} : { processQueries: context.processQueries }),
    ...(context.workspaceState === undefined ? {} : { workspaceState: context.workspaceState }),
    contribute: (contribution) => context.contribute(adaptSdkContribution(contribution)),
  });
  const adaptMatchContext = (context: PluginMatchContext): SdkPluginMatchContext => ({
    identity: adaptPluginWorkspaceIdentity(context.identity),
    evidence: adaptEvidence(context.evidence),
  });
  return {
    id: module.manifest.id,
    version: module.manifest.version,
    manifest: adaptPluginManifest(module.manifest),
    matches: (context) => module.matches(adaptMatchContext(context)),
    ...(module.evidenceKey ? { evidenceKey: (context) => module.evidenceKey?.(adaptMatchContext(context)) ?? "" } : {}),
    activate: (context) => module.activate(adaptContext(context)),
  };
}

export interface AdaptedSdkPluginCatalog {
  readonly plugins: readonly BundledPlugin[];
  readonly diagnostics: readonly PluginDiagnostic[];
}

/** Adapts modules independently so one invalid package cannot hide healthy plugins. */
export function adaptSdkPluginCatalog(modules: readonly SdkPluginModule[]): AdaptedSdkPluginCatalog {
  const plugins: BundledPlugin[] = [];
  const diagnostics: PluginDiagnostic[] = [];
  const ids = new Set<string>();
  for (const module of modules) {
    try {
      const plugin = adaptSdkPluginModule(module);
      if (ids.has(plugin.id)) throw new Error(`Duplicate plugin ID: ${plugin.id}`);
      ids.add(plugin.id);
      plugins.push(plugin);
    } catch (error) {
      diagnostics.push(Object.freeze({
        kind: "invalid-manifest",
        pluginId: typeof module?.id === "string" ? module.id : "unknown",
        message: error instanceof Error ? error.message : String(error),
        error,
      }));
    }
  }
  return Object.freeze({
    plugins: Object.freeze(plugins),
    diagnostics: Object.freeze(diagnostics),
  });
}

function adaptEvidence(evidence: PluginMatchContext["evidence"]): SdkPluginMatchContext["evidence"] {
  if (evidence.kind === "workspace-catalog") return Object.freeze([{ kind: "workspace-catalog", values: catalogValues(evidence) }]);
  return Object.freeze(Object.entries(evidence).map(([kind, value]) => ({ kind, values: { value: typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : String(value) } })));
}

function catalogValues(value: Record<string, unknown>): Readonly<Record<string, string | boolean | number | readonly string[]>> {
  const files = Array.isArray(value.files)
    ? value.files.map((file) => file && typeof file === "object" && typeof (file as { workspacePath?: unknown }).workspacePath === "string" ? (file as { workspacePath: string }).workspacePath : null).filter((file): file is string => file !== null)
    : [];
  return {
    platform: value.platform === "windows" ? "windows" : "posix",
    truncated: value.truncated === true,
    files,
  };
}

export function adaptSdkContribution(contribution: SdkPluginContribution): PluginContribution {
  if (contribution.kind === "command") return contribution;
  if (contribution.kind === "execution-target-provider") {
    return {
      ...contribution,
      snapshot: () => adaptExecutionTargetSnapshot(contribution.snapshot()),
    };
  }
  if (contribution.kind === "run-configuration-provider") {
    return {
      ...contribution,
      snapshot: () => adaptRunConfigurationSnapshot(contribution.snapshot()),
    };
  }
  if (contribution.kind === "language-service") return contribution;
  return {
    ...contribution,
    snapshot: contribution.snapshot,
  } as PluginContribution;
}

function adaptExecutionTargetSnapshot(value: SdkExecutionTargetProviderSnapshot): SdkExecutionTargetProviderSnapshot {
  if (!value || !["loading", "ready", "unavailable", "error"].includes(value.status) ||
    !Array.isArray(value.targets) || value.targets.length > SDK_PLUGIN_EXECUTION_TARGET_LIMITS.maxTargets ||
    (value.selectedTargetId !== null && typeof value.selectedTargetId !== "string") ||
    (value.error !== undefined && !boundedText(value.error, SDK_PLUGIN_EXECUTION_TARGET_LIMITS.maxErrorLength))) {
    throw new Error("Invalid execution target provider snapshot");
  }
  const ids = new Set<string>();
  const targets = value.targets.map((target) => {
    if (!boundedText(target.id, SDK_PLUGIN_EXECUTION_TARGET_LIMITS.maxTargetIdLength) || ids.has(target.id) ||
      !boundedText(target.label, SDK_PLUGIN_EXECUTION_TARGET_LIMITS.maxLabelLength) ||
      (target.detail !== undefined && !boundedText(target.detail, SDK_PLUGIN_EXECUTION_TARGET_LIMITS.maxDetailLength)) ||
      !["online", "offline", "unauthorized", "unknown"].includes(target.status) ||
      typeof target.selectable !== "boolean") throw new Error("Invalid execution target descriptor");
    ids.add(target.id);
    return Object.freeze({
      id: target.id, label: target.label,
      ...(target.detail === undefined ? {} : { detail: target.detail }),
      status: target.status, selectable: target.selectable,
      ...(target.metadata === undefined ? {} : { metadata: freezeMetadata(target.metadata, SDK_PLUGIN_EXECUTION_TARGET_LIMITS) }),
    });
  });
  if (value.selectedTargetId !== null && !ids.has(value.selectedTargetId)) throw new Error("Selected execution target is missing");
  return Object.freeze({
    status: value.status, targets: Object.freeze(targets), selectedTargetId: value.selectedTargetId,
    ...(value.error === undefined ? {} : { error: value.error }),
  });
}

function adaptRunConfigurationSnapshot(value: SdkRunConfigurationProviderSnapshot): SdkRunConfigurationProviderSnapshot {
  if (!value || !["loading", "ready", "error"].includes(value.status) ||
    !Array.isArray(value.configurations) || value.configurations.length > SDK_PLUGIN_RUN_CONFIGURATION_LIMITS.maxConfigurations ||
    (value.selectedConfigurationId !== null && typeof value.selectedConfigurationId !== "string") ||
    (value.error !== undefined && !boundedText(value.error, SDK_PLUGIN_RUN_CONFIGURATION_LIMITS.maxErrorLength))) {
    throw new Error("Invalid run configuration provider snapshot");
  }
  const ids = new Set<string>();
  const configurations = value.configurations.map((configuration) => {
    if (!boundedText(configuration.id, SDK_PLUGIN_RUN_CONFIGURATION_LIMITS.maxConfigurationIdLength) || ids.has(configuration.id) ||
      !boundedText(configuration.label, SDK_PLUGIN_RUN_CONFIGURATION_LIMITS.maxLabelLength) ||
      (configuration.detail !== undefined && !boundedText(configuration.detail, SDK_PLUGIN_RUN_CONFIGURATION_LIMITS.maxDetailLength)) ||
      !["ready", "incomplete", "invalid"].includes(configuration.status) ||
      (configuration.targetProviderId !== undefined && !boundedText(configuration.targetProviderId, SDK_PLUGIN_RUN_CONFIGURATION_LIMITS.maxProviderIdLength))) {
      throw new Error("Invalid run configuration descriptor");
    }
    ids.add(configuration.id);
    return Object.freeze({
      id: configuration.id, label: configuration.label,
      ...(configuration.detail === undefined ? {} : { detail: configuration.detail }),
      status: configuration.status,
      ...(configuration.targetProviderId === undefined ? {} : { targetProviderId: configuration.targetProviderId }),
      ...(configuration.metadata === undefined ? {} : { metadata: freezeMetadata(configuration.metadata, SDK_PLUGIN_RUN_CONFIGURATION_LIMITS) }),
    });
  });
  if (value.selectedConfigurationId !== null && !ids.has(value.selectedConfigurationId)) throw new Error("Selected run configuration is missing");
  return Object.freeze({
    status: value.status, configurations: Object.freeze(configurations), selectedConfigurationId: value.selectedConfigurationId,
    ...(value.error === undefined ? {} : { error: value.error }),
  });
}

function freezeMetadata(
  metadata: Readonly<Record<string, string>>,
  limits: typeof SDK_PLUGIN_EXECUTION_TARGET_LIMITS | typeof SDK_PLUGIN_RUN_CONFIGURATION_LIMITS,
): Readonly<Record<string, string>> {
  const entries = Object.entries(metadata);
  if (entries.length > limits.maxMetadataEntries) throw new Error("Plugin metadata exceeds the limit");
  const result: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!boundedText(key, limits.maxMetadataKeyLength) || !boundedText(value, limits.maxMetadataValueLength)) {
      throw new Error("Plugin metadata is invalid");
    }
    result[key] = value;
  }
  return Object.freeze(result);
}

function boundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && !value.includes("\0");
}

function adaptSetting(value: SdkSettingDescriptor): PluginSettingDescriptor {
  return {
    id: value.id,
    kind: value.kind,
    labelKey: value.labelKey,
    ...(value.descriptionKey === undefined ? {} : { descriptionKey: value.descriptionKey }),
    defaultValue: value.defaultValue,
    ...(value.options === undefined ? {} : { options: value.options.map(adaptOption) }),
  };
}

function adaptOption(value: SdkSettingOption): PluginSettingOption {
  return { value: value.value, labelKey: value.labelKey };
}

function adaptTaskAuthorization(value: SdkTaskAuthorizationDescriptor): SdkTaskAuthorizationDescriptor {
  return Object.freeze({
    workspaceTrust: Object.freeze({
      id: value.workspaceTrust.id,
      labelKey: value.workspaceTrust.labelKey,
      ...(value.workspaceTrust.descriptionKey === undefined
        ? {}
        : { descriptionKey: value.workspaceTrust.descriptionKey }),
    }),
    ...(value.taskConfirmation === undefined
      ? {}
      : {
          taskConfirmation: Object.freeze({
            rememberLabelKey: value.taskConfirmation.rememberLabelKey,
            ...(value.taskConfirmation.rememberDescriptionKey === undefined
              ? {}
              : { rememberDescriptionKey: value.taskConfirmation.rememberDescriptionKey }),
          }),
        }),
  });
}

function adaptWorkspaceTool(value: SdkPluginWorkspaceToolDescriptor): SdkPluginWorkspaceToolDescriptor {
  return Object.freeze({
    id: value.id,
    titleKey: value.titleKey,
    icon: value.icon,
    views: Object.freeze(value.views.map((view) => Object.freeze({ id: view.id, labelKey: view.labelKey }))),
    defaultView: value.defaultView,
  });
}

function adaptProcessQueries(values: readonly SdkProcessQueryDeclaration[]): readonly SdkProcessQueryDeclaration[] {
  return Object.freeze(values.map((query) => Object.freeze({
    id: query.id,
    args: Object.freeze([...query.args]),
    timeoutMs: query.timeoutMs,
    maxOutputBytes: query.maxOutputBytes,
    executables: Object.freeze(query.executables.map((candidate) => Object.freeze({ ...candidate }))),
  })));
}
