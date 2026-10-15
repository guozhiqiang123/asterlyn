import type { PluginTaskCacheBridge, PluginTaskCacheCleanupResult, PluginTaskCacheDirtyReason, PluginTaskCacheMutationResult, PluginTaskCacheReadResult, WorkspaceFingerprint } from "../../protocol/plugin-task-cache.ts";

const records = new Map<string, { fingerprint: WorkspaceFingerprint; payloadBase64: string; updatedAtEpochMs: number; lastAccessEpochMs: number; dirty: boolean; dirtyReason: PluginTaskCacheDirtyReason | null }>();
export const demoPluginTaskCacheBridge: PluginTaskCacheBridge = {
  async computeWorkspaceFingerprint(workspaceRoot, paths): Promise<WorkspaceFingerprint> {
    if (paths.length > 4096 || paths.some((path) => !safePath(path))) return { protocolVersion: 1, status: paths.length > 4096 ? "limitExceeded" : "rejected", workspaceRoot, algorithm: "sha256", digest: null, files: [], truncated: paths.length > 4096, reason: "invalid or oversized fingerprint request", os: "demo", arch: "demo", javaHomeDigest: null };
    const digest = await sha256(`${workspaceRoot}\0${[...paths].sort().join("\0")}`);
    return { protocolVersion: 1, status: "ready", workspaceRoot, algorithm: "sha256", digest, files: [...new Set(paths)].sort().map((path) => ({ path, status: "missing", byteLength: 0, digest: null, modifiedAtEpochMs: null })), truncated: false, reason: null, os: "demo", arch: "demo", javaHomeDigest: null };
  },
  async readPluginTaskCache(workspaceRoot, pluginId, providerId): Promise<PluginTaskCacheReadResult> {
    const value = records.get(`${workspaceRoot}\0${pluginId}\0${providerId}`);
    if (!value) return { protocolVersion: 1, status: "miss", pluginId, providerId, fingerprint: null, payloadBase64: null, updatedAtEpochMs: null, lastAccessEpochMs: null, staleReason: null, dirtyReason: null };
    value.lastAccessEpochMs = Date.now();
    return { protocolVersion: 1, status: value.dirty ? "dirty" : "fresh", pluginId, providerId, fingerprint: value.fingerprint, payloadBase64: value.payloadBase64, updatedAtEpochMs: value.updatedAtEpochMs, lastAccessEpochMs: value.lastAccessEpochMs, staleReason: null, dirtyReason: value.dirty ? value.dirtyReason : null };
  },
  async writePluginTaskCache(workspaceRoot, pluginId, providerId, fingerprint, payloadBase64): Promise<PluginTaskCacheMutationResult> {
    if (!safeIdentifier(pluginId) || !safeIdentifier(providerId) || fingerprint.status !== "ready" || !safeBase64(payloadBase64)) return { protocolVersion: 1, status: "rejected", pluginId: safeIdentifier(pluginId) ? pluginId : null, providerId: safeIdentifier(providerId) ? providerId : null, fingerprint: null, updatedAtEpochMs: null, lastAccessEpochMs: null, dirtyReason: null };
    const bytes = decodedBytes(payloadBase64);
    if (bytes > 16 * 1024 * 1024) return { protocolVersion: 1, status: "limitExceeded", pluginId, providerId, fingerprint: null, updatedAtEpochMs: null, lastAccessEpochMs: null, dirtyReason: null };
    const now = Date.now();
    records.set(`${workspaceRoot}\0${pluginId}\0${providerId}`, { fingerprint, payloadBase64, updatedAtEpochMs: now, lastAccessEpochMs: now, dirty: false, dirtyReason: null });
    while (records.size > 32) { const oldest = [...records.entries()].sort((a, b) => a[1].lastAccessEpochMs - b[1].lastAccessEpochMs)[0]; if (oldest) records.delete(oldest[0]); }
    return { protocolVersion: 1, status: "stored", pluginId, providerId, fingerprint, updatedAtEpochMs: now, lastAccessEpochMs: now, dirtyReason: null };
  },
  async markPluginTaskCacheDirty(workspaceRoot, pluginId, providerId, reason: PluginTaskCacheDirtyReason = "unknown"): Promise<PluginTaskCacheMutationResult> {
    const value = records.get(`${workspaceRoot}\0${pluginId}\0${providerId}`);
    if (value) { value.dirty = true; value.dirtyReason = reason; }
    return { protocolVersion: 1, status: "dirty", pluginId, providerId, fingerprint: value?.fingerprint ?? null, updatedAtEpochMs: value?.updatedAtEpochMs ?? null, lastAccessEpochMs: value?.lastAccessEpochMs ?? null, dirtyReason: reason };
  },
  async cleanupPluginTaskCache(): Promise<PluginTaskCacheCleanupResult> {
    while (records.size > 32 || [...records.values()].reduce((total, value) => total + decodedBytes(value.payloadBase64), 0) > 128 * 1024 * 1024) {
      const oldest = [...records.entries()].sort((a, b) => a[1].lastAccessEpochMs - b[1].lastAccessEpochMs)[0];
      if (!oldest) break;
      records.delete(oldest[0]);
    }
    return { protocolVersion: 1, status: "cleaned", entries: records.size, totalBytes: [...records.values()].reduce((total, value) => total + decodedBytes(value.payloadBase64), 0) };
  },
};

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function safeIdentifier(value: string): boolean { return /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u.test(value); }
function safePath(value: string): boolean { return !!value && !value.includes("\\") && !value.includes("\0") && !value.startsWith("/") && !value.split("/").some((part) => !part || part === "." || part === ".."); }
function safeBase64(value: string): boolean { return value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/u.test(value); }
function decodedBytes(value: string): number { const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0; return value.length / 4 * 3 - padding; }
