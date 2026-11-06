import type { ManagedArtifact, ManagedServerId } from "./generated-native-language-types.ts";

const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_NOTICE_BYTES = 128 * 1024;
const encoder = new TextEncoder();

export interface ManagedLanguageRecipeReference {
  readonly server: ManagedServerId;
  readonly target: string;
  readonly recipeDigest: string;
}

export interface ManagedLanguageRecipeLicense {
  readonly expression: string;
  readonly noticeUrl: string;
  readonly noticeDigest: string;
}

export interface ManagedLanguageRecipeSummary {
  readonly reference: ManagedLanguageRecipeReference;
  readonly version: string;
  readonly archiveDigest: string;
  readonly contentDigest: string;
  readonly downloadBytes: number;
  readonly expandedBytes: number;
  readonly source: string;
  readonly license: ManagedLanguageRecipeLicense;
}

export interface ManagedLanguageRecipeCatalog {
  readonly protocolVersion: 1;
  readonly target: string;
  readonly recipes: readonly ManagedLanguageRecipeSummary[];
}

export interface ManagedLanguageInstallReview {
  readonly protocolVersion: 1;
  readonly reviewId: string;
  readonly kind: "install";
  readonly artifact: ManagedArtifact;
  readonly indexRevision: number;
  readonly downloadBytes: number;
  readonly expandedBytes: number;
  readonly recipe: ManagedLanguageRecipeSummary;
  readonly noticeText: string;
}

export function validateManagedLanguageRecipeCatalog(
  value: unknown,
): ManagedLanguageRecipeCatalog {
  const item = exactObject(value, ["protocolVersion", "target", "recipes"]);
  if (item.protocolVersion !== 1 || !target(item.target) || !Array.isArray(item.recipes)
    || item.recipes.length > 64) invalid();
  const recipes = item.recipes.map(recipeSummary);
  const references = new Set(recipes.map(recipe => JSON.stringify(recipe.reference)));
  if (references.size !== recipes.length
    || recipes.some(recipe => recipe.reference.target !== item.target)) invalid();
  return value as ManagedLanguageRecipeCatalog;
}

export function validateManagedLanguageInstallReview(
  value: unknown,
): ManagedLanguageInstallReview {
  const item = exactObject(value, [
    "protocolVersion", "reviewId", "kind", "artifact", "indexRevision", "downloadBytes",
    "expandedBytes", "recipe", "noticeText",
  ]);
  const artifact = managedArtifact(item.artifact);
  const recipe = recipeSummary(item.recipe);
  if (item.protocolVersion !== 1 || !opaque(item.reviewId, 128) || item.kind !== "install"
    || !safeInteger(item.indexRevision) || !boundedBytes(item.downloadBytes, MAX_DOWNLOAD_BYTES)
    || !boundedBytes(item.expandedBytes, MAX_EXPANDED_BYTES)
    || item.downloadBytes !== recipe.downloadBytes || item.expandedBytes !== recipe.expandedBytes
    || typeof item.noticeText !== "string" || encoder.encode(item.noticeText).length === 0
    || encoder.encode(item.noticeText).length > MAX_NOTICE_BYTES
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(item.noticeText)
    || !sameServer(artifact.server, recipe.reference.server)
    || artifact.version !== recipe.version || artifact.target !== recipe.reference.target
    || artifact.recipeDigest !== recipe.reference.recipeDigest
    || artifact.archiveDigest !== recipe.archiveDigest
    || artifact.contentDigest !== recipe.contentDigest) invalid();
  return value as ManagedLanguageInstallReview;
}

function recipeSummary(value: unknown): ManagedLanguageRecipeSummary {
  const item = exactObject(value, [
    "reference", "version", "archiveDigest", "contentDigest", "downloadBytes", "expandedBytes",
    "source", "license",
  ]);
  const reference = recipeReference(item.reference);
  const license = recipeLicense(item.license);
  if (!version(item.version) || !digest(item.archiveDigest) || !digest(item.contentDigest)
    || !boundedBytes(item.downloadBytes, MAX_DOWNLOAD_BYTES)
    || !boundedBytes(item.expandedBytes, MAX_EXPANDED_BYTES)
    || !httpsUrl(item.source) || !license) invalid();
  return { ...item, reference, license } as unknown as ManagedLanguageRecipeSummary;
}

function recipeReference(value: unknown): ManagedLanguageRecipeReference {
  const item = exactObject(value, ["server", "target", "recipeDigest"]);
  const server = managedServer(item.server);
  if (!target(item.target) || !digest(item.recipeDigest)) invalid();
  return { ...item, server } as unknown as ManagedLanguageRecipeReference;
}

function recipeLicense(value: unknown): ManagedLanguageRecipeLicense {
  const item = exactObject(value, ["expression", "noticeUrl", "noticeDigest"]);
  if (typeof item.expression !== "string" || item.expression.length === 0
    || item.expression.length > 256 || item.expression.trim() !== item.expression
    || !httpsUrl(item.noticeUrl) || !digest(item.noticeDigest)) invalid();
  return item as unknown as ManagedLanguageRecipeLicense;
}

function managedArtifact(value: unknown): ManagedArtifact {
  const item = exactObject(value, [
    "server", "version", "target", "recipeDigest", "archiveDigest", "contentDigest",
  ]);
  const server = managedServer(item.server);
  if (!version(item.version) || !target(item.target)
    || ![item.recipeDigest, item.archiveDigest, item.contentDigest].every(digest)) invalid();
  return { ...item, server } as unknown as ManagedArtifact;
}

function managedServer(value: unknown): ManagedServerId {
  const item = exactObject(value, ["pluginId", "serverId"]);
  if (!identifier(item.pluginId, 160) || !identifier(item.serverId, 128)) invalid();
  return item as unknown as ManagedServerId;
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  const item = value as Record<string, unknown>;
  const actual = Object.keys(item);
  if (actual.length !== keys.length || !keys.every(key => Object.hasOwn(item, key))) invalid();
  return item;
}

function identifier(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum
    && /^[a-z][a-z0-9.-]*$/u.exec(value)?.[0] === value;
}

function opaque(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum
    && /^[A-Za-z0-9._-]+$/u.exec(value)?.[0] === value;
}

function version(value: unknown): value is string {
  return typeof value === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u.exec(value)?.[0] === value;
}

function target(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,79}$/u.exec(value)?.[0] === value;
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.exec(value)?.[0] === value;
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function boundedBytes(value: unknown, maximum: number): value is number {
  return safeInteger(value) && value > 0 && value <= maximum;
}

function httpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || encoder.encode(value).length > 4096) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0 && url.username === ""
      && url.password === "" && url.hash === "";
  } catch {
    return false;
  }
}

function sameServer(left: ManagedServerId, right: ManagedServerId): boolean {
  return left.pluginId === right.pluginId && left.serverId === right.serverId;
}

function invalid(): never {
  throw new Error("Invalid managed language management response");
}
