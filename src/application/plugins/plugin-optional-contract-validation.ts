import {
  SDK_PLUGIN_PROCESS_QUERY_LIMITS,
  SDK_PLUGIN_WORKSPACE_TOOL_LIMITS,
} from "../../../packages/plugin-sdk/index.ts";
import type { BundledPlugin } from "./plugin-types.ts";

const IDENTIFIER = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

export function validateOptionalPluginManifest(plugin: BundledPlugin): void {
  validateWorkspaceTool(plugin.id, plugin.manifest.workspaceTool);
  validateProcessQueries(plugin.id, plugin.manifest.processQueries);
}

function validateWorkspaceTool(pluginId: string, tool: BundledPlugin["manifest"]["workspaceTool"]): void {
  if (tool === undefined) return;
  if (!identifier(tool.id, SDK_PLUGIN_WORKSPACE_TOOL_LIMITS.maxIdLength) ||
    !localizationKey(tool.titleKey, SDK_PLUGIN_WORKSPACE_TOOL_LIMITS.maxTitleKeyLength) ||
    !["device", "list", "puzzle"].includes(tool.icon) ||
    !Array.isArray(tool.views) || tool.views.length === 0 || tool.views.length > SDK_PLUGIN_WORKSPACE_TOOL_LIMITS.maxViews ||
    !identifier(tool.defaultView, SDK_PLUGIN_WORKSPACE_TOOL_LIMITS.maxViewIdLength)) {
    throw new Error(`Invalid plugin workspace tool: ${pluginId}`);
  }
  const ids = new Set<string>();
  for (const view of tool.views) {
    if (!identifier(view.id, SDK_PLUGIN_WORKSPACE_TOOL_LIMITS.maxViewIdLength) || ids.has(view.id) ||
      !localizationKey(view.labelKey, SDK_PLUGIN_WORKSPACE_TOOL_LIMITS.maxViewLabelKeyLength)) {
      throw new Error(`Invalid plugin workspace tool view: ${pluginId}.${view.id}`);
    }
    ids.add(view.id);
  }
  if (!ids.has(tool.defaultView)) throw new Error(`Invalid plugin workspace tool default view: ${pluginId}.${tool.defaultView}`);
}

function validateProcessQueries(pluginId: string, queries: BundledPlugin["manifest"]["processQueries"]): void {
  if (queries === undefined) return;
  if (!Array.isArray(queries) || queries.length > SDK_PLUGIN_PROCESS_QUERY_LIMITS.maxQueries) {
    throw new Error(`Invalid plugin process queries: ${pluginId}`);
  }
  const ids = new Set<string>();
  for (const query of queries) {
    if (!identifier(query.id, SDK_PLUGIN_PROCESS_QUERY_LIMITS.maxIdLength) || ids.has(query.id) ||
      !Array.isArray(query.args) || query.args.length > SDK_PLUGIN_PROCESS_QUERY_LIMITS.maxArguments ||
      !query.args.every((arg: unknown) => typeof arg === "string" && arg.length <= SDK_PLUGIN_PROCESS_QUERY_LIMITS.maxArgumentLength && !arg.includes("\0")) ||
      !Number.isSafeInteger(query.timeoutMs) || query.timeoutMs < 1 || query.timeoutMs > SDK_PLUGIN_PROCESS_QUERY_LIMITS.maxTimeoutMs ||
      !Number.isSafeInteger(query.maxOutputBytes) || query.maxOutputBytes < 1 || query.maxOutputBytes > SDK_PLUGIN_PROCESS_QUERY_LIMITS.maxOutputBytes ||
      !Array.isArray(query.executables) || query.executables.length === 0) {
      throw new Error(`Invalid plugin process query: ${pluginId}.${query.id}`);
    }
    const candidates = new Set<string>();
    for (const candidate of query.executables) {
      let key: string;
      if (candidate.type === "environment") {
        if (!environmentVariable(candidate.variable) || !pathPart(candidate.relativePath, SDK_PLUGIN_PROCESS_QUERY_LIMITS.maxRelativePathLength)) throw invalidExecutable(pluginId, query.id);
        key = `environment:${candidate.variable}:${candidate.relativePath}`;
      } else if (candidate.type === "workspaceProperty") {
        if (!pathPart(candidate.path, SDK_PLUGIN_PROCESS_QUERY_LIMITS.maxWorkspacePropertyPathLength) ||
          !identifier(candidate.key, SDK_PLUGIN_PROCESS_QUERY_LIMITS.maxWorkspacePropertyKeyLength) ||
          !pathPart(candidate.relativePath, SDK_PLUGIN_PROCESS_QUERY_LIMITS.maxRelativePathLength)) throw invalidExecutable(pluginId, query.id);
        key = `workspaceProperty:${candidate.path}:${candidate.key}:${candidate.relativePath}`;
      } else if (candidate.type === "path") {
        if (!pathPart(candidate.name, SDK_PLUGIN_PROCESS_QUERY_LIMITS.maxPathNameLength)) throw invalidExecutable(pluginId, query.id);
        key = `path:${candidate.name}`;
      } else throw invalidExecutable(pluginId, query.id);
      if (candidates.has(key)) throw new Error(`Duplicate process query executable: ${pluginId}.${query.id}`);
      candidates.add(key);
    }
    ids.add(query.id);
  }
}

function identifier(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= limit && IDENTIFIER.test(value);
}
function localizationKey(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= limit && /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u.test(value);
}
function environmentVariable(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= SDK_PLUGIN_PROCESS_QUERY_LIMITS.maxEnvironmentVariableLength && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(value);
}
function pathPart(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= limit && !value.includes("\0") && !value.includes("\\");
}
function invalidExecutable(pluginId: string, queryId: string): Error {
  return new Error(`Invalid process query executable: ${pluginId}.${queryId}`);
}
