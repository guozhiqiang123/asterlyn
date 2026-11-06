import type { SdkCatalogLanguage, SdkCatalogPlatform, SdkCatalogServer, SdkLanguageServerCatalog } from "../../../packages/plugin-sdk/index.ts";
import { freezeLanguageServerCatalog } from "../plugins/language-catalog-contract.ts";

/** Projection identities only: neither a selected provider nor its catalog grants execution. */
export interface LanguageCatalogRegistration {
  readonly pluginId: string;
  readonly catalog: SdkLanguageServerCatalog;
}

export interface CatalogProvider {
  readonly key: string;
  readonly pluginId: string;
  readonly server: SdkCatalogServer;
}

export interface CatalogSelectionContext {
  readonly document: {
    readonly workspacePath: string;
    readonly kind: "editable-source" | "read-only-source" | "historical" | "dependency" | "other";
  } | null;
  readonly hasWorkspace: boolean;
  /** Host-owned enablement/activation intersection for this exact workspace generation. */
  readonly activePluginIds: ReadonlySet<string>;
  readonly platform: SdkCatalogPlatform;
  /** Existing host evidence for root-level filenames; matching never discovers files. */
  readonly rootMarkers: ReadonlySet<string>;
  readonly rootMarkersComplete: boolean;
  readonly preferredProvider: string | null;
}

export type CatalogSelection =
  | { readonly kind: "inactive" | "ineligible-document" | "unknown-language" }
  | { readonly kind: "language-conflict"; readonly languageIds: readonly string[] }
  | { readonly kind: "unconfigured" | "platform-unavailable" | "project-unmatched" | "project-unknown" | "preferred-unavailable"; readonly languageId: string }
  | { readonly kind: "provider-conflict"; readonly languageId: string; readonly providers: readonly CatalogProvider[] }
  | { readonly kind: "selected"; readonly languageId: string; readonly provider: CatalogProvider };

interface RegisteredSelector { readonly pluginId: string; readonly language: SdkCatalogLanguage; }
export const MAX_LANGUAGE_CATALOG_PLUGINS = 64;
export const MAX_CATALOG_DOCUMENT_PATH = 16_384;

export function catalogProviderKey(pluginId: string, serverId: string): string {
  return JSON.stringify([pluginId, serverId]);
}

/** Compile once per admitted catalog change; document changes only query bounded local maps. */
export class LanguageCatalogIndex {
  private readonly suffixes = new Map<string, RegisteredSelector[]>();
  private readonly names = new Map<string, RegisteredSelector[]>();
  private readonly providers = new Map<string, CatalogProvider[]>();

  constructor(registrations: readonly LanguageCatalogRegistration[]) {
    if (registrations.length > MAX_LANGUAGE_CATALOG_PLUGINS) throw new Error("Too many language catalog plugins");
    const ids = new Set<string>();
    for (const registration of registrations) {
      if (/^[a-z][a-z0-9.-]{0,159}$/u.exec(registration.pluginId)?.[0] !== registration.pluginId || ids.has(registration.pluginId)) throw new Error("Invalid language catalog plugin identity");
      ids.add(registration.pluginId);
      const { pluginId } = registration;
      const catalog = freezeLanguageServerCatalog(registration.catalog);
      for (const language of catalog.languages) {
        const selector = { pluginId, language };
        for (const extension of language.extensions) append(this.suffixes, extension, selector);
        for (const name of language.fileNames) append(this.names, name, selector);
      }
      for (const server of catalog.servers) {
        const provider = Object.freeze({ key: catalogProviderKey(pluginId, server.id), pluginId, server });
        for (const language of server.languageIds) append(this.providers, language, provider);
      }
    }
  }

  select(context: CatalogSelectionContext): CatalogSelection {
    if (!context.hasWorkspace || context.activePluginIds.size === 0) return { kind: "inactive" };
    if (context.document?.kind !== "editable-source") return { kind: "ineligible-document" };
    const path = context.document.workspacePath;
    if (path.length === 0 || path.length > MAX_CATALOG_DOCUMENT_PATH || path.startsWith("/") || /^[A-Za-z]:\//u.test(path) || path.includes("\\") || /[\u0000-\u001f\u007f]/u.test(path)
      || path.split("/").some(part => !part || part === "." || part === "..")) return { kind: "ineligible-document" };
    const name = path.slice(path.lastIndexOf("/") + 1);
    const selectors = this.match(name, context.activePluginIds);
    const languageIds = [...new Set(selectors.map(selector => selector.language.id))].sort();
    if (!languageIds.length) return { kind: "unknown-language" };
    if (languageIds.length > 1) return { kind: "language-conflict", languageIds };
    const languageId = languageIds[0]!;
    const candidates = (this.providers.get(languageId) ?? []).filter(provider => context.activePluginIds.has(provider.pluginId));
    if (context.preferredProvider !== null) {
      const preferred = candidates.find(provider => provider.key === context.preferredProvider);
      if (!preferred) return { kind: "preferred-unavailable", languageId };
      if (!preferred.server.platforms.includes(context.platform)) return { kind: "platform-unavailable", languageId };
      const project = projectEligibility(preferred.server, context);
      return project === "eligible" ? { kind: "selected", languageId, provider: preferred } : { kind: project, languageId };
    }
    if (!candidates.length) return { kind: "unconfigured", languageId };
    const platformCandidates = candidates.filter(provider => provider.server.platforms.includes(context.platform));
    if (!platformCandidates.length) return { kind: "platform-unavailable", languageId };
    const eligible = platformCandidates.filter(provider => projectEligibility(provider.server, context) === "eligible");
    // An incomplete snapshot must not temporarily choose a competing provider by omission.
    if (platformCandidates.some(provider => projectEligibility(provider.server, context) === "project-unknown")) return { kind: "project-unknown", languageId };
    if (!eligible.length) return { kind: "project-unmatched", languageId };
    if (eligible.length > 1) return { kind: "provider-conflict", languageId, providers: Object.freeze(eligible) };
    return { kind: "selected", languageId, provider: eligible[0]! };
  }

  private match(name: string, active: ReadonlySet<string>): readonly RegisteredSelector[] {
    const enabled = (values: readonly RegisteredSelector[] | undefined) => values?.filter(value => active.has(value.pluginId)) ?? [];
    const exact = enabled(this.names.get(name));
    if (exact.length) return exact;
    // Catalog suffixes are at most 32 characters: at most 32 lookups, longest match first.
    for (let offset = Math.max(0, name.length - 32); offset < name.length; ++offset) {
      if (name[offset] !== ".") continue;
      const matches = enabled(this.suffixes.get(name.slice(offset)));
      if (matches.length) return matches;
    }
    return [];
  }
}

function projectEligibility(server: SdkCatalogServer, context: CatalogSelectionContext): "eligible" | "project-unmatched" | "project-unknown" {
  if (!server.requireRootMarker || server.rootMarkers.some(marker => context.rootMarkers.has(marker))) return "eligible";
  return context.rootMarkersComplete ? "project-unmatched" : "project-unknown";
}

function append<T>(map: Map<string, T[]>, key: string, value: T): void {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}
