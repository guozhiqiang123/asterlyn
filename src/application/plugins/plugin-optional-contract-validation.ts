import {
  SDK_PLUGIN_PROCESS_QUERY_LIMITS,
  SDK_PLUGIN_TOOL_OPERATION_LIMITS,
  SDK_PLUGIN_WORKSPACE_TOOL_LIMITS,
} from "../../../packages/plugin-sdk/index.ts";
import type { BundledPlugin } from "./plugin-types.ts";
import { HOST_OPERATION_IDS } from "./host-operation-contract.ts";

const IDENTIFIER = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

export function validateOptionalPluginManifest(plugin: BundledPlugin): void {
  validateWorkspaceTool(plugin.id, plugin.manifest.workspaceTool);
  validateProcessQueries(plugin.id, plugin.manifest.processQueries);
  validateToolOperations(plugin.id, plugin.manifest.toolOperations);
  validateHostOperations(plugin.id, plugin.manifest.hostOperations);
}

function validateHostOperations(pluginId: string, operations: BundledPlugin["manifest"]["hostOperations"]): void {
  if (operations === undefined) return;
  if (!Array.isArray(operations) || operations.length > 64) throw new Error(`Invalid plugin host operations: ${pluginId}`);
  const ids = new Set<string>();
  for (const operation of operations) {
    if (!identifier(operation.id, 128) || ids.has(operation.id) || !HOST_OPERATION_IDS.has(operation.id)) {
      throw new Error(`Invalid plugin host operation: ${pluginId}.${operation.id}`);
    }
    ids.add(operation.id);
  }
}

function validateToolOperations(pluginId: string, operations: BundledPlugin["manifest"]["toolOperations"]): void {
  if (operations === undefined) return;
  if (!Array.isArray(operations) || operations.length > SDK_PLUGIN_TOOL_OPERATION_LIMITS.maxOperations) {
    throw new Error(`Invalid plugin tool operations: ${pluginId}`);
  }
  const ids = new Set<string>();
  for (const operation of operations) {
    if (!identifier(operation.id, SDK_PLUGIN_TOOL_OPERATION_LIMITS.maxIdLength) || ids.has(operation.id) ||
      !["query", "mutation"].includes(operation.intent) ||
      !Array.isArray(operation.args) || operation.args.length > SDK_PLUGIN_TOOL_OPERATION_LIMITS.maxArguments ||
      !Array.isArray(operation.parameters) || operation.parameters.length > SDK_PLUGIN_TOOL_OPERATION_LIMITS.maxParameters ||
      !Number.isSafeInteger(operation.timeoutMs) || operation.timeoutMs < 1 || operation.timeoutMs > SDK_PLUGIN_TOOL_OPERATION_LIMITS.maxTimeoutMs ||
      !Number.isSafeInteger(operation.maxOutputBytes) || operation.maxOutputBytes < 1 || operation.maxOutputBytes > SDK_PLUGIN_TOOL_OPERATION_LIMITS.maxOutputBytes ||
      !Array.isArray(operation.executables) || operation.executables.length === 0) {
      throw new Error(`Invalid plugin tool operation: ${pluginId}.${operation.id}`);
    }
    const parameters = new Map<string, string>();
    for (const parameter of operation.parameters) {
      if (!identifier(parameter.name, SDK_PLUGIN_TOOL_OPERATION_LIMITS.maxParameterNameLength) || parameters.has(parameter.name) ||
        !["executionTargetId", "androidApplicationId", "androidComponent", "workspaceArtifact"].includes(parameter.kind) ||
        (parameter.kind === "workspaceArtifact" ? !validArtifactSuffixes(parameter.suffixes) : parameter.suffixes !== undefined)) {
        throw new Error(`Invalid plugin tool-operation parameter: ${pluginId}.${operation.id}`);
      }
      parameters.set(parameter.name, parameter.kind);
    }
    const referenced = new Set<string>();
    for (const argument of operation.args) {
      if (argument.type === "literal") {
        if (typeof argument.value !== "string" || argument.value.length > SDK_PLUGIN_TOOL_OPERATION_LIMITS.maxArgumentLength || argument.value.includes("\0")) {
          throw new Error(`Invalid plugin tool-operation argument: ${pluginId}.${operation.id}`);
        }
      } else if (argument.type === "parameter") {
        if (!parameters.has(argument.name)) throw new Error(`Unknown plugin tool-operation parameter: ${pluginId}.${operation.id}.${argument.name}`);
        referenced.add(argument.name);
      } else throw new Error(`Invalid plugin tool-operation argument: ${pluginId}.${operation.id}`);
    }
    if (referenced.size !== parameters.size) throw new Error(`Unused plugin tool-operation parameter: ${pluginId}.${operation.id}`);
    validateExecutables(pluginId, operation.id, operation.executables);
    ids.add(operation.id);
  }
}

function validArtifactSuffixes(value: readonly string[] | undefined): boolean {
  return Array.isArray(value) && value.length > 0 && value.length <= 8 && value.every((suffix) =>
    typeof suffix === "string" && /^\.[a-z0-9]+$/u.test(suffix) && suffix.length <= SDK_PLUGIN_TOOL_OPERATION_LIMITS.maxArtifactSuffixLength
  );
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
    validateExecutables(pluginId, query.id, query.executables);
    ids.add(query.id);
  }
}

function validateExecutables(pluginId: string, operationId: string, executables: readonly import("../../../packages/plugin-sdk/index.ts").SdkProcessExecutableCandidate[]): void {
  const candidates = new Set<string>();
  for (const candidate of executables) {
    let key: string;
    if (candidate.type === "environment") {
      if (!environmentVariable(candidate.variable) || !pathPart(candidate.relativePath, SDK_PLUGIN_PROCESS_QUERY_LIMITS.maxRelativePathLength)) throw invalidExecutable(pluginId, operationId);
      key = `environment:${candidate.variable}:${candidate.relativePath}`;
    } else if (candidate.type === "workspaceProperty") {
      if (!pathPart(candidate.path, SDK_PLUGIN_PROCESS_QUERY_LIMITS.maxWorkspacePropertyPathLength) ||
        !identifier(candidate.key, SDK_PLUGIN_PROCESS_QUERY_LIMITS.maxWorkspacePropertyKeyLength) ||
        !pathPart(candidate.relativePath, SDK_PLUGIN_PROCESS_QUERY_LIMITS.maxRelativePathLength)) throw invalidExecutable(pluginId, operationId);
      key = `workspaceProperty:${candidate.path}:${candidate.key}:${candidate.relativePath}`;
    } else if (candidate.type === "path") {
      if (!pathPart(candidate.name, SDK_PLUGIN_PROCESS_QUERY_LIMITS.maxPathNameLength)) throw invalidExecutable(pluginId, operationId);
      key = `path:${candidate.name}`;
    } else if (candidate.type === "androidSdkBuildTools") {
      if (!pathPart(candidate.name, SDK_PLUGIN_PROCESS_QUERY_LIMITS.maxPathNameLength)) throw invalidExecutable(pluginId, operationId);
      key = `androidSdkBuildTools:${candidate.name}`;
    } else throw invalidExecutable(pluginId, operationId);
    if (candidates.has(key)) throw new Error(`Duplicate process executable: ${pluginId}.${operationId}`);
    candidates.add(key);
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
