import type {
  BundledPlugin,
  PluginProcessQueriesCapability,
  PluginWorkspaceIdentity,
} from "../application/plugins/index.ts";
import type {
  PluginProcessQueryBridge,
  PluginProcessQueryResult,
} from "../protocol/plugin-process-query.ts";
import { hostProcessQueryIds } from "../application/plugins/host-operation-contract.ts";

export function createPluginProcessQueriesCapability(
  bridge: PluginProcessQueryBridge | undefined,
  plugin: BundledPlugin,
  identity: PluginWorkspaceIdentity,
): PluginProcessQueriesCapability | undefined {
  const declarations = plugin.manifest.processQueries;
  const admitted = new Set([
    ...(declarations ?? []).map((query) => query.id),
    ...hostProcessQueryIds(plugin.manifest.hostOperations),
  ]);
  if (!bridge || admitted.size === 0) return undefined;
  return Object.freeze({
    execute: async (queryId: string) => {
      if (!admitted.has(queryId)) throw new Error(`Plugin process query is not declared: ${queryId}`);
      const result = await bridge.executePluginProcessQuery(identity.root, plugin.id, queryId);
      if (result.pluginId !== plugin.id || result.queryId !== queryId) {
        throw new Error("Plugin process query response identity does not match the request.");
      }
      return adaptResult(result);
    },
  });
}

function adaptResult(result: PluginProcessQueryResult) {
  const stdout = decodeUtf8(result.stdoutBase64);
  const stderr = decodeUtf8(result.stderrBase64);
  switch (result.status) {
    case "succeeded":
    case "failed":
    case "cancelled":
      return Object.freeze({
        status: result.status,
        stdout,
        stderr,
        truncated: result.truncated,
        error: result.error,
      });
    case "timedOut":
      return Object.freeze({
        status: "timed-out" as const,
        stdout,
        stderr,
        truncated: result.truncated,
        error: result.error,
      });
    case "unavailable":
    case "crashed":
      return Object.freeze({
        status: "failed" as const,
        stdout,
        stderr,
        truncated: result.truncated,
        error: result.error ?? (result.status === "unavailable"
          ? "The required host tool is unavailable."
          : "The host process query crashed."),
      });
  }
}

function decodeUtf8(value: string): string {
  const binary = globalThis.atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}
