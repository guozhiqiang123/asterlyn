import assert from "node:assert/strict";
import test from "node:test";

import { createPluginToolOperationExecutor } from "../src/composition/plugin-tool-operation-capability.ts";
import { assertPluginToolOperationResult } from "../src/protocol/plugin-tool-operation.ts";

const plugin = {
  id: "dev.asterlyn.android-gradle",
  version: "1.0.0",
  manifest: {
    toolOperations: [{
      id: "android.adb.launch",
      parameters: [
        { name: "target", kind: "executionTargetId" },
        { name: "component", kind: "androidComponent" },
      ],
    }],
  },
};
const identity = { root: "/workspace/android", generation: 3 };

test("tool-operation executor binds plugin, workspace, identity, and declared parameters", async () => {
  const calls = [];
  const executor = createPluginToolOperationExecutor({
    async executePluginToolOperation(root, pluginId, requestId, operationId, parameters) {
      calls.push({ root, pluginId, requestId, operationId, parameters });
      return {
        protocolVersion: 1, pluginId, requestId, operationId, status: "succeeded",
        stdoutBase64: btoa("Starting: Intent\n"), stderrBase64: "", truncated: false,
        exitCode: 0, error: null,
      };
    },
    async cancelPluginToolOperation() {},
  }, plugin, identity);
  assert.ok(executor);
  const result = await executor.execute("run-1", {
    operationId: "android.adb.launch",
    parameters: { target: "emulator-5554", component: "com.example/com.example.MainActivity" },
  });
  assert.equal(result.stdout, "Starting: Intent\n");
  assert.equal(calls[0].root, identity.root);
  await assert.rejects(() => executor.execute("run-2", {
    operationId: "android.adb.launch", parameters: { target: "emulator-5554" },
  }), /parameters do not match/u);
});

test("tool-operation result validator rejects mismatched transport data", () => {
  assert.throws(() => assertPluginToolOperationResult({
    protocolVersion: 1,
    pluginId: "plugin",
    requestId: "run-1",
    operationId: "operation",
    status: "unavailable",
    stdoutBase64: "",
    stderrBase64: "",
    truncated: false,
    exitCode: null,
    error: null,
  }, "result"), /status/u);
});
