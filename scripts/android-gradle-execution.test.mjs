import assert from "node:assert/strict";
import test from "node:test";

import { applyGradleTaskResult, buildGradleTaskRunPlan, runnableGradleSnapshot, setGradleTaskRunState } from "../src/plugins/android-gradle/index.ts";

const evidence = { kind: "android-gradle-evidence", workspaceRoot: "/repo", generation: 4, platform: "posix", bounded: true, catalogTruncated: false, gradle: true, android: true, wrapper: "gradlew", evidence: [] };
const discovered = { status: "ready", tasks: [
  { id: ":assemble", label: ":assemble", group: "Build tasks", projectPath: ":", description: "build", runnable: false },
  { id: ":app:assembleDebug", label: ":app:assembleDebug", group: "Build tasks", projectPath: ":app", runnable: false },
] };

test("builds exact task plans and rejects unknown or stale task IDs", () => {
  const snapshot = runnableGradleSnapshot(discovered);
  assert.deepEqual(buildGradleTaskRunPlan(evidence, snapshot, ":app:assembleDebug"), {
    pluginId: "dev.asterlyn.android-gradle", providerId: "gradle-tasks", taskId: ":app:assembleDebug", label: ":app:assembleDebug", executablePath: "gradlew", args: [":app:assembleDebug", "--console=plain", "--no-daemon", "--no-scan"],
  });
  assert.equal(buildGradleTaskRunPlan(evidence, snapshot, ":missing"), null);
  assert.equal(buildGradleTaskRunPlan({ ...evidence, platform: "windows" }, snapshot, ":assemble"), null);
  assert.equal(buildGradleTaskRunPlan({ ...evidence, bounded: false }, snapshot, ":assemble"), null);
});

test("result application preserves discovery and updates only the exact task state", () => {
  const snapshot = runnableGradleSnapshot(discovered);
  const updated = applyGradleTaskResult(snapshot, ":app:assembleDebug", { status: "failed", outputs: [], truncated: false, error: "exit 1" });
  assert.equal(updated.tasks.length, 2);
  assert.equal(updated.tasks.find((task) => task.id === ":app:assembleDebug").runState, "failed");
  assert.equal(updated.tasks.find((task) => task.id === ":assemble").runState, "idle");
  assert.equal(applyGradleTaskResult(snapshot, ":missing", { status: "cancelled", outputs: [], truncated: false, error: null }).tasks.length, 2);
});

test("a replacement snapshot does not make a removed task runnable", () => {
  const snapshot = runnableGradleSnapshot(discovered);
  const replacement = runnableGradleSnapshot({ status: "ready", tasks: [discovered.tasks[0]] });
  assert.equal(buildGradleTaskRunPlan(evidence, replacement, ":app:assembleDebug"), null);
  assert.equal(buildGradleTaskRunPlan(evidence, snapshot, ":assemble")?.taskId, ":assemble");
});

test("starting a new task clears older terminal row state", () => {
  const prior = applyGradleTaskResult(runnableGradleSnapshot(discovered), ":app:assembleDebug", { status: "failed", outputs: [], truncated: false, error: "exit 1" });
  const queued = setGradleTaskRunState(prior, ":assemble", "queued");
  assert.equal(queued.tasks.find((task) => task.id === ":app:assembleDebug").runState, "idle");
  assert.equal(queued.tasks.find((task) => task.id === ":assemble").runState, "queued");
});
