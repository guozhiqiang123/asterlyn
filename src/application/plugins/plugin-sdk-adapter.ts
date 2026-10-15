import type {
  SdkPluginManifest,
  SdkSettingDescriptor,
  SdkSettingOption,
  SdkWorkspaceIdentity,
} from "../../../packages/plugin-sdk/index.ts";
import type {
  BundledPluginManifest,
  PluginSettingDescriptor,
  PluginSettingOption,
  PluginWorkspaceIdentity,
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
  return {
    id: manifest.id,
    version: manifest.version,
    nameKey: manifest.nameKey,
    descriptionKey: manifest.descriptionKey,
    settings: manifest.settings.map(adaptSetting),
  };
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
