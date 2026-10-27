import type { PluginLanguageServiceContribution } from "./plugin-types.ts";

const LANGUAGE_IDS = new Set(["typescript", "typescriptreact", "javascript", "javascriptreact"]);
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);

/** Validate the complete declaration before projection; malformed metadata is never repaired. */
export function validateLanguageServiceContribution(value: unknown): asserts value is PluginLanguageServiceContribution {
  const item = value as Partial<PluginLanguageServiceContribution> | null;
  const rust = item?.serverId === "rust-analyzer";
  const packaged = typeof item?.serverId === "string" && /^[a-z][a-z0-9.-]{0,127}$/u.test(item.serverId) && item.serverId !== "typescript" && !rust;
  if (!item || (!packaged && !rust && item.serverId !== "typescript") ||
    typeof item.label !== "string" || item.label.length > 120 || !item.label.trim() ||
    /[\u0000-\u001f\u007f]/u.test(item.label) ||
    !validList(item.languageIds, 16, (entry) => packaged ? /^[a-z][a-z0-9-]{0,63}$/u.test(entry) : rust ? entry === "rust" : LANGUAGE_IDS.has(entry)) ||
    !validList(item.extensions, 16, (entry) => packaged ? /^\.[a-z][a-z0-9.]{0,31}$/u.test(entry) : rust ? entry === ".rs" : EXTENSIONS.has(entry)) ||
    !validList(item.rootMarkers, 8, (entry) => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(entry))) {
    throw new Error("Invalid language service contribution");
  }
}

function validList(value: unknown, maximum: number, accepts: (item: string) => boolean): boolean {
  return Array.isArray(value) && value.length > 0 && value.length <= maximum &&
    value.every((item) => typeof item === "string" && accepts(item)) &&
    new Set(value).size === value.length;
}
