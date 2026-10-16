import type { PluginToolOperationBridge, PluginToolOperationResult } from "../../protocol/plugin-tool-operation.ts";
import { invokeDesktopCommandUnvalidated } from "./desktop-command-adapter.ts";

export const tauriPluginToolOperationBridge: PluginToolOperationBridge = {
  executePluginToolOperation(workspaceRoot, pluginId, requestId, operationId, parameters) {
    return invokeDesktopCommandUnvalidated("execute_plugin_tool_operation", {
      workspaceRoot, pluginId, requestId, operationId, parameters: { ...parameters },
    }).then(async (value) => {
      const { assertPluginToolOperationResult } = await import("../../protocol/plugin-tool-operation.ts");
      const assertResult: (candidate: unknown, label: string) => asserts candidate is PluginToolOperationResult = assertPluginToolOperationResult;
      assertResult(value, "execute_plugin_tool_operation");
      return value;
    });
  },
  cancelPluginToolOperation(requestId) {
    return invokeDesktopCommandUnvalidated("cancel_plugin_tool_operation", { requestId }).then(() => undefined);
  },
};
