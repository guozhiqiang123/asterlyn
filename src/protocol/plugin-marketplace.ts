import type { DesktopCommandName } from "./generated-desktop-protocol.ts";
import { assert, record } from "./desktop-result-validation-primitives.ts";

export type PluginSourceCatalogStatus = "available" | "noRelease" | "error" | "rateLimited";

export interface PluginSourceCatalog {
  readonly status: PluginSourceCatalogStatus;
  readonly checkedAtEpochMs: number;
  readonly stale: boolean;
  readonly version: string | null;
  readonly releaseUrl: string | null;
  readonly assetName: string | null;
  readonly assetDownloadUrl: string | null;
  readonly assetSizeBytes: number | null;
  readonly digest: string | null;
  readonly error: string | null;
  readonly rateLimitResetEpochMs: number | null;
  readonly etag: string | null;
  readonly lastModified: string | null;
}

export interface PluginSource {
  readonly repository: string;
  readonly name: string;
  readonly description: string;
  readonly builtIn: boolean;
  readonly enabled: boolean;
  readonly catalog: PluginSourceCatalog | null;
}

export interface PluginSourceSnapshot {
  readonly schemaVersion: 1;
  readonly generation: number;
  readonly sources: readonly PluginSource[];
  readonly recovered: boolean;
}

export interface PluginMarketplaceBridge {
  listPluginSources(): Promise<PluginSourceSnapshot>;
  upsertPluginSource(repository: string, name: string, description: string): Promise<PluginSourceSnapshot>;
  setPluginSourceEnabled(repository: string, enabled: boolean): Promise<PluginSourceSnapshot>;
  removePluginSource(repository: string): Promise<PluginSourceSnapshot>;
  refreshPluginSource(repository: string): Promise<PluginSourceSnapshot>;
  listPluginInstallations(): Promise<PluginInstallationSnapshot>;
  preparePluginInstall(repository: string): Promise<PluginPackageAdmissionReview>;
  confirmPluginInstall(reviewToken: string): Promise<PluginInstallationSnapshot>;
  cancelPluginInstall(reviewToken: string): Promise<void>;
  restartForPluginChanges(): Promise<void>;
  setInstalledPluginEnabled(pluginId: string, enabled: boolean): Promise<PluginInstallationSnapshot>;
  selectInstalledPluginRollback(pluginId: string, version: string, packageDigest: string): Promise<PluginInstallationSnapshot>;
  uninstallInstalledPlugin(pluginId: string): Promise<PluginInstallationSnapshot>;
}

export type PluginRuntimeStatus = "pendingRuntime" | "pendingRestart" | "active" | "knownGood" | "quarantined";
export interface AdmittedPluginVersion { readonly version: string; readonly packageDigest: string; readonly admittedAtEpochMs: number; readonly runtimeStatus: PluginRuntimeStatus; }
export interface InstalledPlugin { readonly pluginId: string; readonly repository: string; readonly enabled: boolean; readonly bundledFallback: boolean; readonly activeVersion: string | null; readonly knownGoodVersion: string | null; readonly pendingVersion: string | null; readonly versions: readonly AdmittedPluginVersion[]; }
export interface PluginInstallationSnapshot { readonly schemaVersion: 1; readonly generation: number; readonly plugins: readonly InstalledPlugin[]; readonly recovered: boolean; }
export interface PluginPackageAdmissionReview { readonly reviewToken: string; readonly repository: string; readonly sourceGeneration: number; readonly assetName: string; readonly assetSizeBytes: number; readonly digest: string; readonly pluginId: string; readonly version: string; readonly licenseExpression: string; readonly capabilities: readonly string[]; readonly permissions: readonly string[]; readonly expandedBytes: number; }

export function validatePluginSourceSnapshot(value: unknown, command: DesktopCommandName): PluginSourceSnapshot {
  const snapshot = record(value, command);
  assert(typeof snapshot.schemaVersion === "number", command, "schemaVersion must be a number");
  assert(typeof snapshot.generation === "number", command, "generation must be a number");
  assert(typeof snapshot.recovered === "boolean", command, "recovered must be a boolean");
  assert(snapshot.schemaVersion === 1, command, "expected plugin source schema 1");
  assert(Number.isSafeInteger(snapshot.generation) && snapshot.generation > 0, command, "invalid source generation");
  assert(Array.isArray(snapshot.sources), command, "sources must be an array");
  assert(snapshot.sources.length <= 64, command, "too many plugin sources");
  const repositories = new Set<string>();
  for (const sourceValue of snapshot.sources) {
    const source = record(sourceValue, command);
    assert(typeof source.repository === "string", command, "repository must be a string");
    assert(typeof source.name === "string", command, "name must be a string");
    assert(typeof source.description === "string", command, "description must be a string");
    assert(typeof source.builtIn === "boolean", command, "builtIn must be a boolean");
    assert(typeof source.enabled === "boolean", command, "enabled must be a boolean");
    assert(source.repository.length <= 200 && /^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(source.repository), command, "invalid repository identity");
    assert(!repositories.has(source.repository), command, "duplicate repository identity");
    repositories.add(source.repository);
    assert(source.name.length > 0 && source.name.length <= 80, command, "invalid source name");
    assert(source.description.length > 0 && source.description.length <= 500, command, "invalid source description");
    assert(source.catalog === null || typeof source.catalog === "object", command, "catalog must be an object or null");
    if (source.catalog !== null) validateCatalog(source.catalog, command);
  }
  return value as PluginSourceSnapshot;
}

function validateCatalog(value: unknown, command: DesktopCommandName): void {
  const catalog = record(value, command);
  assert(typeof catalog.status === "string", command, "status must be a string");
  assert(typeof catalog.checkedAtEpochMs === "number", command, "checkedAtEpochMs must be a number");
  assert(typeof catalog.stale === "boolean", command, "stale must be a boolean");
  for (const field of ["version", "releaseUrl", "assetName", "assetDownloadUrl", "digest", "error", "etag", "lastModified"] as const) {
    assert(catalog[field] === null || typeof catalog[field] === "string", command, `${field} must be a string or null`);
  }
  assert(
    ["available", "noRelease", "error", "rateLimited"].includes(catalog.status),
    command,
    "invalid source catalog status",
  );
  for (const field of ["assetSizeBytes", "rateLimitResetEpochMs"] as const) {
    assert(
      catalog[field] === null || (typeof catalog[field] === "number" && Number.isSafeInteger(catalog[field]) && catalog[field] > 0),
      command,
      `${field} must be a positive integer or null`,
    );
  }
  const hasRelease = catalog.version !== null && catalog.releaseUrl !== null && catalog.assetName !== null && catalog.assetDownloadUrl !== null &&
    catalog.assetSizeBytes !== null && catalog.digest !== null;
  assert(catalog.status !== "available" || hasRelease, command, "available catalog requires complete Release metadata");
  assert(catalog.status === "available" || catalog.error !== null, command, "unavailable catalog requires an error");
  assert(!hasRelease || catalog.status === "available" || catalog.stale === true, command, "cached Release metadata must be stale");
}

export function validatePluginInstallationSnapshot(value: unknown, command: DesktopCommandName): PluginInstallationSnapshot {
  const snapshot = record(value, command);
  assert(snapshot.schemaVersion === 1, command, "expected plugin installation schema 1");
  assert(typeof snapshot.generation === "number" && Number.isSafeInteger(snapshot.generation) && snapshot.generation > 0, command, "invalid installation generation");
  assert(typeof snapshot.recovered === "boolean", command, "recovered must be a boolean");
  assert(Array.isArray(snapshot.plugins) && snapshot.plugins.length <= 64, command, "invalid installed plugin list");
  for (const item of snapshot.plugins) {
    const plugin = record(item, command);
    assert(typeof plugin.pluginId === "string" && plugin.pluginId.length > 0, command, "invalid installed plugin ID");
    assert(typeof plugin.repository === "string" && plugin.repository.includes("/"), command, "invalid installed repository");
    assert(typeof plugin.enabled === "boolean" && typeof plugin.bundledFallback === "boolean", command, "invalid installed flags");
    for (const field of ["activeVersion", "knownGoodVersion", "pendingVersion"] as const) assert(plugin[field] === null || typeof plugin[field] === "string", command, `${field} must be a string or null`);
    assert(Array.isArray(plugin.versions) && plugin.versions.length <= 64, command, "invalid admitted version list");
    for (const item of plugin.versions) {
      const version = record(item, command);
      assert(typeof version.version === "string" && typeof version.packageDigest === "string" && /^sha256:[a-f0-9]{64}$/u.test(version.packageDigest), command, "invalid admitted version");
      assert(typeof version.admittedAtEpochMs === "number" && Number.isSafeInteger(version.admittedAtEpochMs), command, "invalid admission time");
      assert(["pendingRuntime", "pendingRestart", "active", "knownGood", "quarantined"].includes(String(version.runtimeStatus)), command, "invalid runtime status");
    }
  }
  return value as PluginInstallationSnapshot;
}

export function validatePluginPackageAdmissionReview(value: unknown, command: DesktopCommandName): PluginPackageAdmissionReview {
  const review = record(value, command);
  for (const field of ["reviewToken", "repository", "assetName", "digest", "pluginId", "version", "licenseExpression"] as const) assert(typeof review[field] === "string" && review[field].length > 0, command, `${field} must be non-empty`);
  assert(/^[a-f0-9]{64}$/u.test(String(review.reviewToken)), command, "invalid review token");
  assert(/^sha256:[a-f0-9]{64}$/u.test(String(review.digest)), command, "invalid package digest");
  for (const field of ["sourceGeneration", "assetSizeBytes", "expandedBytes"] as const) assert(typeof review[field] === "number" && Number.isSafeInteger(review[field]) && review[field] > 0, command, `${field} must be positive`);
  for (const field of ["capabilities", "permissions"] as const) assert(Array.isArray(review[field]) && review[field].every((item) => typeof item === "string"), command, `${field} must be strings`);
  return value as PluginPackageAdmissionReview;
}
