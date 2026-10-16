import type { PluginProcessQueryBridge } from "../../protocol/plugin-process-query.ts";

export const demoPluginProcessQueryBridge: PluginProcessQueryBridge = {
  async executePluginProcessQuery(_workspaceRoot, pluginId, queryId) {
    return {
      protocolVersion: 1,
      pluginId,
      queryId,
      status: "unavailable",
      stdoutBase64: "",
      stderrBase64: "",
      truncated: false,
      exitCode: null,
      error: "Native process queries are unavailable in demo mode.",
    };
  },
};
