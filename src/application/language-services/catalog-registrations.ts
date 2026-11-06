import type { PluginManagementSnapshot } from "../plugins/plugin-types.ts";
import type { LanguageCatalogRegistration } from "./catalog-selection.ts";

/**
 * Project management state is the activation authority. Catalog metadata from
 * installed-but-inactive packages must never enter recommendation selection.
 */
export function activeLanguageCatalogRegistrations(
  snapshot: PluginManagementSnapshot,
): readonly LanguageCatalogRegistration[] {
  return Object.freeze(snapshot.entries.flatMap((entry) =>
    entry.enabled && entry.active && entry.languageServerCatalog !== undefined
      ? [Object.freeze({ pluginId: entry.id, catalog: entry.languageServerCatalog })]
      : []));
}
