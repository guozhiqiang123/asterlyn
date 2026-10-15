import type {
  SdkPluginActivationContext,
  SdkPluginContribution,
  SdkPluginManifest,
  SdkPluginMatchContext,
  SdkPluginModule,
  SdkSettingDescriptor,
  SdkSettingOption,
  SdkWorkspaceIdentity,
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
  };
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
    contribute: (contribution) => context.contribute(adaptContribution(contribution)),
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

function adaptContribution(contribution: SdkPluginContribution): PluginContribution {
  if (contribution.kind === "command") return contribution;
  return {
    ...contribution,
    snapshot: contribution.snapshot,
  } as PluginContribution;
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
