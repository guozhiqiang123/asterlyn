export interface WorkspaceFingerprintFile { path: string; status: "present" | "missing"; byteLength: number; digest: string | null; modifiedAtEpochMs: number | null; }
export type WorkspaceFingerprintStatus = "ready" | "rejected" | "limitExceeded" | "unavailable";
export interface WorkspaceFingerprint { protocolVersion: 1; status: WorkspaceFingerprintStatus; workspaceRoot: string; algorithm: "sha256"; digest: string | null; files: WorkspaceFingerprintFile[]; truncated: boolean; reason: string | null; os: string; arch: string; javaHomeDigest: string | null; }
export type PluginTaskCacheDirtyReason = "workspace-change" | "watcher-ambiguous" | "manual" | "unknown";
export type PluginTaskCacheReadStatus = "miss" | "fresh" | "stale" | "dirty" | "corrupt" | "limitExceeded" | "unavailable";
export interface PluginTaskCacheReadResult { protocolVersion: 1; status: PluginTaskCacheReadStatus; pluginId: string; providerId: string; fingerprint: WorkspaceFingerprint | null; payloadBase64: string | null; updatedAtEpochMs: number | null; lastAccessEpochMs: number | null; staleReason: "expired" | "future-timestamp" | null; dirtyReason: PluginTaskCacheDirtyReason | null; }
export type PluginTaskCacheMutationStatus = "stored" | "rejected" | "limitExceeded" | "dirty" | "unavailable";
export interface PluginTaskCacheMutationResult { protocolVersion: 1; status: PluginTaskCacheMutationStatus; pluginId: string | null; providerId: string | null; fingerprint: WorkspaceFingerprint | null; updatedAtEpochMs: number | null; lastAccessEpochMs: number | null; dirtyReason: PluginTaskCacheDirtyReason | null; }
export interface PluginTaskCacheCleanupResult { protocolVersion: 1; status: "cleaned" | "unavailable"; entries: number; totalBytes: number; }

export const PLUGIN_TASK_CACHE_LIMITS = Object.freeze({ maxFingerprintFiles: 4096, maxFingerprintBytes: 64 * 1024 * 1024, maxPayloadBytes: 16 * 1024 * 1024 });

export interface PluginTaskCacheBridge {
  computeWorkspaceFingerprint(workspaceRoot: string, paths: readonly string[]): Promise<WorkspaceFingerprint>;
  readPluginTaskCache(workspaceRoot: string, pluginId: string, providerId: string): Promise<PluginTaskCacheReadResult>;
  writePluginTaskCache(workspaceRoot: string, pluginId: string, providerId: string, fingerprint: WorkspaceFingerprint, payloadBase64: string): Promise<PluginTaskCacheMutationResult>;
  markPluginTaskCacheDirty(workspaceRoot: string, pluginId: string, providerId: string, reason?: PluginTaskCacheDirtyReason): Promise<PluginTaskCacheMutationResult>;
  cleanupPluginTaskCache(): Promise<PluginTaskCacheCleanupResult>;
}

export function parseWorkspaceFingerprint(value: unknown): WorkspaceFingerprint {
  const source = record(value, "Workspace fingerprint");
  protocol(source, "Workspace fingerprint");
  if (source.algorithm !== "sha256") throw new Error("Workspace fingerprint algorithm is invalid.");
  const workspaceRoot = text(source.workspaceRoot, "workspaceRoot", 16_384);
  const os = text(source.os, "os", 64);
  const arch = text(source.arch, "arch", 64);
  const javaHomeDigest = source.javaHomeDigest === null ? null : digestText(source.javaHomeDigest, "javaHomeDigest");
  const status = source.status;
  if (!["ready", "rejected", "limitExceeded", "unavailable"].includes(status as string)) throw new Error("Workspace fingerprint status is invalid.");
  const digest = source.digest === null ? null : digestText(source.digest, "digest");
  if (!Array.isArray(source.files) || source.files.length > PLUGIN_TASK_CACHE_LIMITS.maxFingerprintFiles) throw new Error("Workspace fingerprint files exceed the limit.");
  if (typeof source.truncated !== "boolean") throw new Error("Workspace fingerprint truncated is invalid.");
  const files = source.files.map((value) => {
    const file = record(value, "Workspace fingerprint file");
    const path = relativePath(file.path);
    if (file.status !== "present" && file.status !== "missing") throw new Error("Workspace fingerprint file status is invalid.");
    if (!Number.isSafeInteger(file.byteLength) || (file.byteLength as number) < 0) throw new Error("Workspace fingerprint byteLength is invalid.");
    const fileDigest = file.digest === null ? null : digestText(file.digest, "file digest");
    const modifiedAtEpochMs = nullableEpoch(file.modifiedAtEpochMs);
    if (file.status === "present" && (fileDigest === null || modifiedAtEpochMs === null)) throw new Error("Present fingerprint files require digest and modification time.");
    if (file.status === "missing" && (fileDigest !== null || file.byteLength !== 0 || modifiedAtEpochMs !== null)) throw new Error("Missing fingerprint files must be empty.");
    return { path, status: file.status as "present" | "missing", byteLength: file.byteLength as number, digest: fileDigest, modifiedAtEpochMs };
  });
  if (files.some((file, index) => index > 0 && files[index - 1]!.path >= file.path)) throw new Error("Workspace fingerprint files must be sorted and unique.");
  const total = files.reduce((sum, file) => sum + file.byteLength, 0);
  if (total > PLUGIN_TASK_CACHE_LIMITS.maxFingerprintBytes) throw new Error("Workspace fingerprint exceeds the byte limit.");
  const reason = source.reason === null ? null : text(source.reason, "reason", 256);
  if (status === "ready" && (!digest || source.truncated !== false || reason !== null)) throw new Error("Ready workspace fingerprints must be complete.");
  if (status !== "ready" && (digest !== null || reason === null)) throw new Error("Unavailable workspace fingerprints require a reason and no digest.");
  return { protocolVersion: 1, status: status as WorkspaceFingerprintStatus, workspaceRoot, algorithm: "sha256", digest, files, truncated: source.truncated as boolean, reason, os, arch, javaHomeDigest };
}

export function parsePluginTaskCacheRead(value: unknown): PluginTaskCacheReadResult {
  const source = record(value, "Plugin task cache read");
  protocol(source, "Plugin task cache read");
  const status = source.status;
  if (!["miss", "fresh", "stale", "dirty", "corrupt", "limitExceeded", "unavailable"].includes(status as string)) throw new Error("Plugin task cache read status is invalid.");
  const fingerprint = source.fingerprint === null ? null : parseWorkspaceFingerprint(source.fingerprint);
  const payloadBase64 = source.payloadBase64 === null ? null : boundedBase64(source.payloadBase64);
  if ((status === "fresh" || status === "stale" || status === "dirty") && (!fingerprint || fingerprint.status !== "ready" || !payloadBase64)) throw new Error("A usable plugin task cache entry requires fingerprint and payload.");
  const staleReason = source.staleReason === null ? null : (source.staleReason === "expired" || source.staleReason === "future-timestamp" ? source.staleReason : (() => { throw new Error("Plugin cache stale reason is invalid."); })());
  const dirtyReason = parseDirtyReason(source.dirtyReason);
  if (status === "fresh" && (staleReason !== null || dirtyReason !== null)) throw new Error("Fresh cache entries cannot have stale or dirty reasons.");
  if (status === "stale" && (staleReason === null || dirtyReason !== null)) throw new Error("Stale cache entries require only a stale reason.");
  if (status === "dirty" && (dirtyReason === null || staleReason !== null)) throw new Error("Dirty cache entries require only a dirty reason.");
  if (["miss", "corrupt", "limitExceeded", "unavailable"].includes(status as string) && (fingerprint !== null || payloadBase64 !== null || source.updatedAtEpochMs !== null || source.lastAccessEpochMs !== null || staleReason !== null || dirtyReason !== null)) throw new Error("Non-hit cache entries cannot contain cache state.");
  return { protocolVersion: 1, status: status as PluginTaskCacheReadStatus, pluginId: identifier(source.pluginId, "pluginId"), providerId: identifier(source.providerId, "providerId"), fingerprint, payloadBase64, updatedAtEpochMs: nullableEpoch(source.updatedAtEpochMs), lastAccessEpochMs: nullableEpoch(source.lastAccessEpochMs), staleReason, dirtyReason };
}

export function parsePluginTaskCacheMutation(value: unknown): PluginTaskCacheMutationResult {
  const source = record(value, "Plugin task cache mutation");
  protocol(source, "Plugin task cache mutation");
  if (!["stored", "rejected", "limitExceeded", "dirty", "unavailable"].includes(source.status as string)) throw new Error("Plugin task cache mutation status is invalid.");
  const status = source.status as PluginTaskCacheMutationStatus;
  const fingerprint = source.fingerprint === null ? null : parseWorkspaceFingerprint(source.fingerprint);
  const dirtyReason = parseDirtyReason(source.dirtyReason);
  if (status === "stored" && (!source.pluginId || !source.providerId || !fingerprint || fingerprint.status !== "ready" || source.updatedAtEpochMs === null || source.lastAccessEpochMs === null || dirtyReason !== null)) throw new Error("Stored cache mutations require complete state.");
  if (status === "dirty" && (dirtyReason === null || !source.pluginId || !source.providerId)) throw new Error("Dirty cache mutations require ids and a reason.");
  if (status === "dirty" && ((fingerprint === null) !== (source.updatedAtEpochMs === null && source.lastAccessEpochMs === null))) throw new Error("Dirty cache state must be complete or empty.");
  if (["rejected", "limitExceeded", "unavailable"].includes(status) && (fingerprint !== null || source.updatedAtEpochMs !== null || source.lastAccessEpochMs !== null || dirtyReason !== null)) throw new Error("Failed cache mutations cannot contain stored state.");
  return { protocolVersion: 1, status, pluginId: source.pluginId === null ? null : identifier(source.pluginId, "pluginId"), providerId: source.providerId === null ? null : identifier(source.providerId, "providerId"), fingerprint, updatedAtEpochMs: nullableEpoch(source.updatedAtEpochMs), lastAccessEpochMs: nullableEpoch(source.lastAccessEpochMs), dirtyReason };
}

export function parsePluginTaskCacheCleanup(value: unknown): PluginTaskCacheCleanupResult {
  const source = record(value, "Plugin task cache cleanup");
  protocol(source, "Plugin task cache cleanup");
  if (source.status !== "cleaned" && source.status !== "unavailable") throw new Error("Plugin task cache cleanup status is invalid.");
  if (!Number.isSafeInteger(source.entries) || (source.entries as number) < 0 || !Number.isSafeInteger(source.totalBytes) || (source.totalBytes as number) < 0) throw new Error("Plugin task cache cleanup totals are invalid.");
  return { protocolVersion: 1, status: source.status, entries: source.entries as number, totalBytes: source.totalBytes as number };
}

export function validatePluginTaskCacheDesktopResult(validator: string, value: unknown): boolean {
  const parsers: Readonly<Record<string, (source: unknown) => unknown>> = {
    workspaceFingerprint: parseWorkspaceFingerprint,
    pluginTaskCacheReadResult: parsePluginTaskCacheRead,
    pluginTaskCacheMutationResult: parsePluginTaskCacheMutation,
    pluginTaskCacheCleanupResult: parsePluginTaskCacheCleanup,
  };
  const parser = parsers[validator];
  if (!parser) return false;
  parser(value);
  return true;
}

function record(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`); return value as Record<string, unknown>; }
function protocol(value: Record<string, unknown>, label: string): void { if (value.protocolVersion !== 1) throw new Error(`${label} has unsupported protocol version.`); }
function text(value: unknown, field: string, max: number): string { if (typeof value !== "string" || !value || value.length > max || value.includes("\0")) throw new Error(`Plugin cache ${field} is invalid.`); return value; }
function identifier(value: unknown, field: string): string { const result = text(value, field, 128); if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u.test(result)) throw new Error(`Plugin cache ${field} is invalid.`); return result; }
function digestText(value: unknown, field: string): string { if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) throw new Error(`Plugin cache ${field} is invalid.`); return value; }
function relativePath(value: unknown): string { const path = text(value, "path", 4096); if (path.startsWith("/") || path.startsWith("\\") || path.split("/").some((part) => !part || part === "." || part === "..") || path.includes("\\")) throw new Error("Workspace fingerprint path is not normalized relative."); return path; }
function boundedBase64(value: unknown): string { const maxEncoded = Math.ceil(PLUGIN_TASK_CACHE_LIMITS.maxPayloadBytes / 3) * 4; const textValue = text(value, "payloadBase64", maxEncoded + 4); if (textValue.length > maxEncoded) throw new Error("Plugin task cache payload exceeds the limit."); const padding = textValue.match(/=*$/u)?.[0].length ?? 0; const body = padding > 0 ? textValue.slice(0, -padding) : textValue; if (textValue.length % 4 !== 0 || padding > 2 || !/^[A-Za-z0-9+/]*$/u.test(body)) throw new Error("Plugin task cache payload is invalid base64."); const decoded = Math.floor(textValue.length * 3 / 4) - padding; if (decoded > PLUGIN_TASK_CACHE_LIMITS.maxPayloadBytes) throw new Error("Plugin task cache payload exceeds the limit."); return textValue; }
function nullableEpoch(value: unknown): number | null { if (value === null) return null; if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("Plugin cache timestamp is invalid."); return value as number; }
function parseDirtyReason(value: unknown): PluginTaskCacheDirtyReason | null { if (value === null) return null; if (value === "workspace-change" || value === "watcher-ambiguous" || value === "manual" || value === "unknown") return value; throw new Error("Plugin cache dirty reason is invalid."); }
