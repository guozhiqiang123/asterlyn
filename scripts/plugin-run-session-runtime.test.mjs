import assert from "node:assert/strict";
import test from "node:test";

import { PluginRunSessionRuntime } from "../src/composition/plugin-run-session-runtime.ts";

const identity = { root: "/workspace/android", generation: 7 };

test("staged Run builds, resolves, installs on the selected target, launches, and retains one terminal transcript", async () => {
  const phases = [];
  const terminal = [];
  const applied = [];
  const runtime = new PluginRunSessionRuntime({
    executeBuild: async () => ({
      result: { status: "succeeded", outputs: [], truncated: false, error: null },
      terminalSessionId: "terminal-1",
    }),
    discoverArtifacts: async () => ({ artifacts: [{ workspacePath: "app/build/outputs/apk/debug/app.apk", kind: "apk", byteLength: 12 }], sidecars: [] }),
    executeTool: async (_pluginId, _identity, requestId, request) => ({
      status: "succeeded",
      stdout: request.operationId === "android.apk.inspect"
        ? "package: name='com.example'\nlaunchable-activity: name='com.example.MainActivity'\n"
        : "Starting: Intent\n",
      stderr: "",
      truncated: false,
      exitCode: 0,
      error: null,
      requestId,
    }),
    cancelTool: async () => undefined,
    taskTerminal: {
      begin() {},
      append: (_id, frame) => terminal.push(new TextDecoder().decode(Uint8Array.from(atob(frame.dataBase64), (value) => value.charCodeAt(0)))),
      update: (_id, status) => terminal.push(`status:${status}`),
      reveal: () => true,
    },
    changed: (snapshot) => { if (snapshot) phases.push(`${snapshot.status}:${snapshot.phase}`); },
    completed: () => undefined,
    reportError: (error) => { throw error; },
  });
  const plan = {
    kind: "staged",
    build: {
      request: { pluginId: "dev.asterlyn.android-gradle", providerId: "gradle-tasks", taskId: ":app:assembleDebug", label: "Build", executablePath: "/workspace/android/gradlew", args: [":app:assembleDebug"] },
      artifactSearch: { hints: ["app/build/outputs/apk"] },
      apply: (result) => applied.push(`build:${result.status}`),
    },
    inspect: (artifacts) => ({ operationId: "android.apk.inspect", parameters: { artifact: artifacts[0].workspacePath } }),
    deploy: () => ({ operationId: "android.adb.install", parameters: { target: "emulator-5554", artifact: "app/build/outputs/apk/debug/app.apk" } }),
    launch: () => ({ operationId: "android.adb.launch", parameters: { target: "emulator-5554", component: "com.example/com.example.MainActivity" } }),
    apply: (result) => applied.push(`run:${result.status}:${result.phase}`),
  };
  await runtime.run({ identity, pluginId: "dev.asterlyn.android-gradle", label: "app Debug", plan, revalidateTarget: async () => true });
  assert.deepEqual(phases, [
    "running:building", "running:resolving-artifact", "running:validating-target", "running:installing", "running:validating-target",
    "running:launching", "succeeded:launching",
  ]);
  assert.deepEqual(applied, ["build:succeeded", "run:succeeded:launching"]);
  assert.match(terminal.join(""), /Resolving built Android application/u);
  assert.match(terminal.join(""), /Installing application on selected device/u);
  assert.match(terminal.join(""), /Starting: Intent/u);
  assert.equal(terminal.at(-1), "status:succeeded");
  assert.equal(runtime.busy, false);
});

test("staged Run stops before launch when target revalidation fails", async () => {
  let launchCount = 0;
  let final = null;
  const runtime = new PluginRunSessionRuntime({
    executeBuild: async () => ({ result: { status: "succeeded", outputs: [], truncated: false, error: null }, terminalSessionId: null }),
    discoverArtifacts: async () => ({ artifacts: [{ workspacePath: "app/build/outputs/apk/debug/app.apk", kind: "apk", byteLength: 12 }], sidecars: [] }),
    executeTool: async (_pluginId, _identity, _requestId, request) => {
      if (request.operationId === "android.adb.launch") launchCount += 1;
      return { status: "succeeded", stdout: "manifest", stderr: "", truncated: false, exitCode: 0, error: null };
    },
    cancelTool: async () => undefined,
    changed: () => undefined,
    completed: (_request, snapshot) => { final = snapshot; },
    reportError: () => undefined,
  });
  const plan = {
    kind: "staged",
    build: { request: { pluginId: "plugin", providerId: "tasks", taskId: "assemble", label: "Build", executablePath: "/gradlew", args: ["assemble"] }, artifactSearch: { hints: ["app/build/outputs/apk"] }, apply() {} },
    inspect: () => ({ operationId: "android.apk.inspect", parameters: { artifact: "app/build/outputs/apk/debug/app.apk" } }),
    launch: () => ({ operationId: "android.adb.launch", parameters: { target: "phone", component: "com.example/com.example.Main" } }),
    apply() {},
  };
  await runtime.run({ identity, pluginId: "plugin", label: "Run", plan, revalidateTarget: async () => false });
  assert.equal(launchCount, 0);
  assert.equal(final.status, "failed");
  assert.equal(final.phase, "validating-target");
});
