import type { SdkPluginDependency } from "../../packages/plugin-sdk/index.ts";

const ID = /^[A-Za-z0-9._-]{1,160}$/u;
const CORE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
export function dependencyVersion(value: unknown): readonly bigint[] {
  if (typeof value !== "string" || value.length > 64 || !CORE.test(value)) throw new Error("Invalid stable dependency version");
  const parts = value.split(".").map(BigInt);
  if (parts.some((value) => value > 0xffffffffffffffffn)) throw new Error("Dependency version exceeds its bound");
  return parts;
}
function compare(left: readonly bigint[], right: readonly bigint[]): number {
  for (let index = 0; index < 3; index += 1) { if (left[index]! < right[index]!) return -1; if (left[index]! > right[index]!) return 1; }
  return 0;
}
export function validatePluginDependencies(owner: string, value: unknown): asserts value is readonly SdkPluginDependency[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 16) throw new Error("Plugin dependencies exceed their bound");
  const ids = new Set<string>();
  for (const dependency of value) {
    if (!dependency || typeof dependency !== "object" || Array.isArray(dependency) || Object.keys(dependency).some((key) => !["id", "minimum", "maximumExclusive"].includes(key)) ||
      typeof dependency.id !== "string" || !ID.test(dependency.id) || [".", "..", owner].includes(dependency.id) || ids.has(dependency.id)) throw new Error("Invalid required plugin identity");
    const minimum = dependencyVersion(dependency.minimum);
    if (dependency.maximumExclusive !== undefined && compare(dependencyVersion(dependency.maximumExclusive), minimum) <= 0) throw new Error("Invalid dependency version interval");
    ids.add(dependency.id);
  }
}

interface DependencyInstallation {
  readonly pluginId: string;
  readonly enabled: boolean;
  readonly requiredDependencies?: readonly SdkPluginDependency[];
  readonly activeVersion: string | null;
  readonly pendingVersion: string | null;
  readonly knownGoodVersion: string | null;
  readonly versions: readonly { readonly version: string; readonly admittedAtEpochMs: number; readonly dependencies?: readonly SdkPluginDependency[] }[];
}
/** UI projection only; native installation transactions independently enforce every mutation. */
export function installedPluginDependents(plugins: readonly DependencyInstallation[], target: string): readonly string[] {
  if (plugins.length > 64) throw new Error("Plugin dependency graph exceeds its bound");
  const edges = new Map<string, readonly SdkPluginDependency[]>();
  for (const plugin of plugins) {
    const pointers = new Set([plugin.activeVersion, plugin.pendingVersion].filter((value): value is string => value !== null));
    const selected = plugin.versions.filter((version) => pointers.has(version.version));
    if (selected.length === 0) {
      const fallback = plugin.versions.find((version) => version.version === plugin.knownGoodVersion) ??
        [...plugin.versions].sort((left, right) => right.admittedAtEpochMs - left.admittedAtEpochMs)[0];
      if (fallback) selected.push(fallback);
    }
    validatePluginDependencies(plugin.pluginId, plugin.requiredDependencies);
    for (const version of selected) validatePluginDependencies(plugin.pluginId, version.dependencies);
    edges.set(plugin.pluginId, [...(plugin.requiredDependencies ?? []), ...selected.flatMap((version) => version.dependencies ?? [])]);
  }
  const reaches = (id: string, seen: Set<string>): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    return (edges.get(id) ?? []).some((dependency) => dependency.id === target || reaches(dependency.id, seen));
  };
  return plugins.filter((plugin) => plugin.enabled && plugin.pluginId !== target && reaches(plugin.pluginId, new Set())).map((plugin) => plugin.pluginId);
}
