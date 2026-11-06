import type { SdkLanguageServerCatalog } from "../../../packages/plugin-sdk/index.ts";
import { LANGUAGE_CATALOG_PATTERNS, LANGUAGE_CATALOG_SCHEMA } from "../../protocol/generated-language-catalog-schema.ts";

type Schema = Readonly<Record<string, unknown>>;
const definitions: Readonly<Record<string, Schema>> = LANGUAGE_CATALOG_SCHEMA.definitions;
const patterns = Object.fromEntries(Object.entries(LANGUAGE_CATALOG_PATTERNS).map(([key, value]) => [key, new RegExp(value, "u")]));
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const unique = (values: readonly unknown[]): boolean => new Set(values).size === values.length;
const matches = (key: keyof typeof LANGUAGE_CATALOG_PATTERNS, value: string): boolean => patterns[key]!.exec(value)?.[0] === value;
const fileName = (value: string): boolean => value.length <= 128 && value !== "." && value !== ".." && matches("fileName", value);

/** Strict input validation; the schema and string patterns come from the native owner. */
export function validateLanguageServerCatalog(value: unknown): asserts value is SdkLanguageServerCatalog {
  let nodes = 0;
  const check = (schema: Schema, item: unknown, depth: number): boolean => {
    if (++nodes > 8192 || depth > 16) return false;
    if (typeof schema.$ref === "string") {
      const target = definitions[schema.$ref.split("/").at(-1)!];
      return !!target && check(target, item, depth + 1);
    }
    if (Array.isArray(schema.enum)) return schema.enum.includes(item);
    switch (schema.type) {
      case "object": {
        if (!record(item) || !record(schema.properties) || !Array.isArray(schema.required)) return false;
        if (!schema.required.every(key => typeof key === "string" && Object.hasOwn(item, key))) return false;
        if (schema.additionalProperties !== false || Object.keys(item).some(key => !Object.hasOwn(schema.properties as object, key))) return false;
        return Object.entries(schema.properties).every(([key, property]) => record(property) && check(property, item[key], depth + 1));
      }
      case "array": return Array.isArray(item) && item.length >= Number(schema.minItems ?? 0) && item.length <= Number(schema.maxItems ?? 0)
        && record(schema.items) && item.every(entry => check(schema.items as Schema, entry, depth + 1));
      case "integer": return Number.isSafeInteger(item) && Number(item) >= Number(schema.minimum) && Number(item) <= Number(schema.maximum);
      case "string": return typeof item === "string" && item.length <= 256;
      case "boolean": return typeof item === "boolean";
      default: return false;
    }
  };
  const invalid = (): never => { throw new Error("Invalid language server catalog"); };
  if (!check(LANGUAGE_CATALOG_SCHEMA, value, 0)) invalid();
  const catalog = value as SdkLanguageServerCatalog;
  const languageIds = new Set(catalog.languages.map(language => language.id));
  if (languageIds.size !== catalog.languages.length || !unique(catalog.servers.map(server => server.id))) invalid();
  for (const language of catalog.languages) {
    if (!matches("languageId", language.id) || !matches("labelKey", language.labelKey)
      || language.extensions.length + language.fileNames.length === 0
      || !unique(language.extensions) || !unique(language.fileNames)
      || language.extensions.some(extension => extension.length > 32 || !matches("extension", extension))
      || language.fileNames.some(name => !fileName(name))) invalid();
  }
  for (const server of catalog.servers) {
    if (!matches("serverId", server.id) || !matches("labelKey", server.labelKey) || !matches("repository", server.upstream.repository)
      || !unique(server.languageIds) || server.languageIds.some(id => !languageIds.has(id))
      || !unique(server.platforms) || !unique(server.rootMarkers) || server.rootMarkers.some(marker => !fileName(marker))
      || server.requireRootMarker && server.rootMarkers.length === 0) invalid();
  }
}

/** Detach immutable metadata so descriptor changes cannot change an admitted catalog. */
export function freezeLanguageServerCatalog(value: unknown): SdkLanguageServerCatalog {
  validateLanguageServerCatalog(value);
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    languages: Object.freeze(value.languages.map(language => Object.freeze({ ...language,
      extensions: Object.freeze([...language.extensions]), fileNames: Object.freeze([...language.fileNames]),
    }))),
    servers: Object.freeze(value.servers.map(server => Object.freeze({ ...server,
      languageIds: Object.freeze([...server.languageIds]), upstream: Object.freeze({ ...server.upstream }),
      platforms: Object.freeze([...server.platforms]), rootMarkers: Object.freeze([...server.rootMarkers]),
    }))),
  });
}
