import type { PluginProcessQueryBridge, PluginProcessQueryResult } from "../../protocol/plugin-process-query.ts";
import { invokeDesktopCommandUnvalidated } from "./desktop-command-adapter.ts";

export const tauriPluginProcessQueryBridge: PluginProcessQueryBridge = {
  executePluginProcessQuery(
    workspaceRoot: string,
    pluginId: string,
    queryId: string,
  ): Promise<PluginProcessQueryResult> {
    return invokeDesktopCommandUnvalidated("execute_plugin_process_query", {
      workspaceRoot,
      pluginId,
      queryId,
    }).then(async (value) => {
      const { assertPluginProcessQueryResult } = await import("../../protocol/plugin-process-query.ts");
      const assertResult: (
        candidate: unknown,
        label: string,
      ) => asserts candidate is PluginProcessQueryResult = assertPluginProcessQueryResult;
      assertResult(value, "execute_plugin_process_query");
      return value;
    });
  },
};
