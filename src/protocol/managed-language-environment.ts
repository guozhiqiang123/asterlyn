import type { SdkCatalogPlatform } from "../../packages/plugin-sdk/index.ts";
import type { ManagedInstallationSnapshot } from "./generated-native-language-types.ts";
import { validateManagedInstallationSnapshot } from "./managed-language-installation.ts";

const PLATFORMS = new Set<SdkCatalogPlatform>([
  "macos-arm64", "macos-x64", "linux-arm64", "linux-x64", "windows-arm64", "windows-x64",
]);

export interface ManagedLanguageEnvironment {
  readonly protocolVersion: 1;
  readonly platform: SdkCatalogPlatform;
  readonly target: string;
  readonly installation: ManagedInstallationSnapshot;
}

export function validateManagedLanguageEnvironment(value: unknown): ManagedLanguageEnvironment {
  const invalid = (): never => { throw new Error("Invalid managed language environment"); };
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== 4 || !["protocolVersion", "platform", "target", "installation"].every(key => Object.hasOwn(item, key))
    || item.protocolVersion !== 1 || typeof item.platform !== "string" || !PLATFORMS.has(item.platform as SdkCatalogPlatform)
    || typeof item.target !== "string" || /^[a-z0-9][a-z0-9._-]{0,79}$/u.exec(item.target)?.[0] !== item.target) invalid();
  validateManagedInstallationSnapshot(item.installation);
  return value as ManagedLanguageEnvironment;
}
