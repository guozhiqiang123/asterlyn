import type {
  PluginTaskCacheCapability,
  PluginWorkspaceIdentity,
} from "../application/plugins/index.ts";
import type { PluginTaskCacheBridge } from "../protocol/plugin-task-cache.ts";
import type {
  PluginTaskCacheDirtyReason,
  WorkspaceFingerprint,
} from "../protocol/plugin-task-cache.ts";

const PROVIDER_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

/** Removes raw bridge addressing from plugin code by binding root and plugin ID here. */
export function createPluginTaskCacheCapability(
  bridge: PluginTaskCacheBridge | undefined,
  identity: PluginWorkspaceIdentity,
  pluginId: string,
): PluginTaskCacheCapability {
  const provider = (providerId: string): string => {
    if (!PROVIDER_ID.test(providerId)) throw new Error(`Invalid plugin cache provider ID: ${providerId}`);
    return providerId;
  };
  if (!bridge) return unavailableCapability(identity, pluginId, provider);
  const capability: PluginTaskCacheCapability = {
    computeFingerprint: (paths: readonly string[]) => bridge.computeWorkspaceFingerprint(identity.root, [...paths]),
    read: (providerId: string) => bridge.readPluginTaskCache(identity.root, pluginId, provider(providerId)),
    write: (providerId: string, fingerprint: WorkspaceFingerprint, payloadBase64: string) => bridge.writePluginTaskCache(
      identity.root,
      pluginId,
      provider(providerId),
      fingerprint,
      payloadBase64,
    ),
    markDirty: (providerId: string, reason: PluginTaskCacheDirtyReason) => bridge.markPluginTaskCacheDirty(
      identity.root,
      pluginId,
      provider(providerId),
      reason,
    ),
  };
  return Object.freeze(capability);
}

function unavailableCapability(
  identity: PluginWorkspaceIdentity,
  pluginId: string,
  provider: (providerId: string) => string,
): PluginTaskCacheCapability {
  const mutation = (providerId: string) => Promise.resolve({
    protocolVersion: 1 as const,
    status: "unavailable" as const,
    pluginId,
    providerId: provider(providerId),
    fingerprint: null,
    updatedAtEpochMs: null,
    lastAccessEpochMs: null,
    dirtyReason: null,
  });
  return Object.freeze({
    computeFingerprint: () => Promise.resolve({
      protocolVersion: 1 as const,
      status: "unavailable" as const,
      workspaceRoot: identity.root,
      algorithm: "sha256" as const,
      digest: null,
      files: [],
      truncated: false,
      reason: "Plugin task caching is unavailable.",
      os: "unknown",
      arch: "unknown",
      javaHomeDigest: null,
    }),
    read: (providerId: string) => Promise.resolve({
      protocolVersion: 1 as const,
      status: "unavailable" as const,
      pluginId,
      providerId: provider(providerId),
      fingerprint: null,
      payloadBase64: null,
      updatedAtEpochMs: null,
      lastAccessEpochMs: null,
      staleReason: null,
      dirtyReason: null,
    }),
    write: (providerId: string) => mutation(providerId),
    markDirty: (providerId: string) => mutation(providerId),
  });
}
