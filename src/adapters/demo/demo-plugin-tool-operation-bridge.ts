import type { PluginToolOperationBridge } from "../../protocol/plugin-tool-operation.ts";

export const demoPluginToolOperationBridge: PluginToolOperationBridge = {
  async executePluginToolOperation(_workspaceRoot, pluginId, requestId, operationId) {
    return {
      protocolVersion: 1,
      pluginId,
      requestId,
      operationId,
      status: "failed",
      stdoutBase64: "",
      stderrBase64: "",
      truncated: false,
      exitCode: null,
      error: "Native plugin tool operations are unavailable in demo mode.",
    };
  },
  async cancelPluginToolOperation() {},
};
