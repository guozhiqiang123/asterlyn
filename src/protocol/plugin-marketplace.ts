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
}

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
  for (const field of ["version", "releaseUrl", "assetName", "digest", "error", "etag", "lastModified"] as const) {
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
  const hasRelease = catalog.version !== null && catalog.releaseUrl !== null && catalog.assetName !== null &&
    catalog.assetSizeBytes !== null && catalog.digest !== null;
  assert(catalog.status !== "available" || hasRelease, command, "available catalog requires complete Release metadata");
  assert(catalog.status === "available" || catalog.error !== null, command, "unavailable catalog requires an error");
  assert(!hasRelease || catalog.status === "available" || catalog.stale === true, command, "cached Release metadata must be stale");
}
