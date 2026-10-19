import type {
  PluginCatalogEntry,
  PluginToolOperationRequest,
  PluginToolOperationResult,
  PluginWorkspaceIdentity,
} from "../application/plugins/index.ts";
import type { PluginToolOperationBridge } from "../protocol/plugin-tool-operation.ts";

export interface PluginToolOperationExecutor {
  execute(requestId: string, request: PluginToolOperationRequest): Promise<PluginToolOperationResult>;
  cancel(requestId: string): Promise<void>;
}

export function createPluginToolOperationExecutor(
  bridge: PluginToolOperationBridge | undefined,
  plugin: Pick<PluginCatalogEntry, "id" | "manifest">,
  identity: PluginWorkspaceIdentity,
): PluginToolOperationExecutor | undefined {
  const declarations = plugin.manifest.toolOperations;
  if (!bridge || !declarations || declarations.length === 0) return undefined;
  const admitted = new Map(declarations.map((operation) => [operation.id, operation]));
  return Object.freeze({
    execute: async (requestId: string, request: PluginToolOperationRequest) => {
      const declaration = admitted.get(request.operationId);
      if (!declaration) throw new Error(`Plugin tool operation is not declared: ${request.operationId}`);
      const names = Object.keys(request.parameters).sort();
      const declaredNames = declaration.parameters.map((parameter) => parameter.name).sort();
      if (names.length !== declaredNames.length || names.some((name, index) => name !== declaredNames[index])) {
        throw new Error(`Plugin tool-operation parameters do not match the declaration: ${request.operationId}`);
      }
      for (const value of Object.values(request.parameters)) {
        if (typeof value !== "string" || value.length === 0 || value.length > 4_096 || value.includes("\0")) {
          throw new Error(`Plugin tool-operation parameter is invalid: ${request.operationId}`);
        }
      }
      const result = await bridge.executePluginToolOperation(
        identity.root,
        plugin.id,
        requestId,
        request.operationId,
        request.parameters,
      );
      if (result.pluginId !== plugin.id || result.requestId !== requestId || result.operationId !== request.operationId) {
        throw new Error("Plugin tool-operation response identity does not match the request.");
      }
      return adaptResult(result);
    },
    cancel: (requestId: string) => bridge.cancelPluginToolOperation(requestId),
  });
}

function adaptResult(result: Awaited<ReturnType<PluginToolOperationBridge["executePluginToolOperation"]>>): PluginToolOperationResult {
  return Object.freeze({
    status: result.status === "timedOut" ? "timed-out" : result.status,
    stdout: decodeUtf8(result.stdoutBase64),
    stderr: decodeUtf8(result.stderrBase64),
    truncated: result.truncated,
    exitCode: result.exitCode,
    error: result.error,
  });
}

function decodeUtf8(value: string): string {
  const binary = globalThis.atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}
