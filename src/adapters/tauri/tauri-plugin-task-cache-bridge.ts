import { invokeDesktopCommand } from "./desktop-command-adapter.ts";
import { parsePluginTaskCacheCleanup, parsePluginTaskCacheMutation, parsePluginTaskCacheRead, parseWorkspaceFingerprint, type PluginTaskCacheBridge, type PluginTaskCacheDirtyReason } from "../../protocol/plugin-task-cache.ts";

export const tauriPluginTaskCacheBridge: PluginTaskCacheBridge = {
  computeWorkspaceFingerprint: async (workspaceRoot, paths) => parseWorkspaceFingerprint(await invokeDesktopCommand("compute_workspace_fingerprint", { workspaceRoot, paths: [...paths] })),
  readPluginTaskCache: async (workspaceRoot, pluginId, providerId) => parsePluginTaskCacheRead(await invokeDesktopCommand("read_plugin_task_cache", { workspaceRoot, pluginId, providerId })),
  writePluginTaskCache: async (workspaceRoot, pluginId, providerId, fingerprint, payloadBase64) => parsePluginTaskCacheMutation(await invokeDesktopCommand("write_plugin_task_cache", { workspaceRoot, pluginId, providerId, fingerprint, payloadBase64 })),
  markPluginTaskCacheDirty: async (workspaceRoot, pluginId, providerId, reason: PluginTaskCacheDirtyReason = "unknown") => parsePluginTaskCacheMutation(await invokeDesktopCommand("mark_plugin_task_cache_dirty", { workspaceRoot, pluginId, providerId, reason })),
  cleanupPluginTaskCache: async () => parsePluginTaskCacheCleanup(await invokeDesktopCommand("cleanup_plugin_task_cache", {})),
};
