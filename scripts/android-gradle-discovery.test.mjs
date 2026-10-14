import assert from "node:assert/strict";
import test from "node:test";

import {
  ANDROID_GRADLE_DISCOVERY_LIMITS,
  ANDROID_GRADLE_TASK_ARGS,
  buildGradleWrapperRequest,
  parseGradleTasksOutput,
} from "../src/plugins/android-gradle/index.ts";

function evidence(platform = "posix", wrapper = platform === "windows" ? "gradlew.bat" : "gradlew") {
  return { kind: "android-gradle-evidence", workspaceRoot: "/repo", generation: 3, platform, bounded: true, catalogTruncated: false, gradle: true, android: true, wrapper, evidence: [] };
}

test("selects the platform-matching wrapper with fixed host-owned arguments", () => {
  const posix = buildGradleWrapperRequest(evidence());
  assert.equal(posix.supported, true);
  assert.equal(posix.request.executablePath, "gradlew");
  assert.deepEqual(posix.request.args, ANDROID_GRADLE_TASK_ARGS);
  const windows = buildGradleWrapperRequest(evidence("windows"));
  assert.equal(windows.supported, true);
  assert.equal(windows.request.executablePath, "gradlew.bat");
  assert.equal(buildGradleWrapperRequest(evidence("windows", "gradlew")).supported, false);
  assert.equal(buildGradleWrapperRequest(evidence("posix", null)).reason, "wrapper-missing");
  assert.equal(buildGradleWrapperRequest({ ...evidence(), bounded: false }).supported, false);
  assert.equal(buildGradleWrapperRequest({ ...evidence(), catalogTruncated: true }).supported, false);
});

test("parses root and multi-module tasks deterministically, deduplicating descriptions", () => {
  const result = parseGradleTasksOutput(`\u001b[32mTasks runnable from root project 'demo'\u001b[0m\r\nBuild tasks\r\n-----------\r\nassemble - Assembles the outputs\r\n:app:assembleDebug - Assembles debug\r\n:app:assembleDebug - duplicate\r\nfeature:lint - Lints feature\r\nTasks runnable from project ':app'\r\nHelp tasks\r\n----------\r\nhelp\r\n`);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.tasks.map(({ id, projectPath, description, runnable }) => ({ id, projectPath, description, runnable })), [
    { id: ":app:assembleDebug", projectPath: ":app", description: "Assembles debug", runnable: false },
    { id: ":assemble", projectPath: ":", description: "Assembles the outputs", runnable: false },
    { id: ":app:help", projectPath: ":app", description: undefined, runnable: false },
    { id: ":feature:lint", projectPath: ":feature", description: "Lints feature", runnable: false },
  ].sort((a, b) => a.id.localeCompare(b.id)));
});

test("handles noise, malformed output, failure, and bounds without throwing", () => {
  assert.equal(parseGradleTasksOutput("Daemon will be stopped\n:help\n").status, "error");
  assert.equal(parseGradleTasksOutput("Welcome to Gradle\nDaemon will be stopped\n").status, "error");
  assert.equal(parseGradleTasksOutput("FAILURE: Build failed with an exception").status, "error");
  assert.equal(parseGradleTasksOutput("x".repeat(ANDROID_GRADLE_DISCOVERY_LIMITS.maxLineLength + 1)).status, "error");
  assert.equal(parseGradleTasksOutput(new Uint8Array(ANDROID_GRADLE_DISCOVERY_LIMITS.maxOutputBytes + 1)).status, "error");
  const many = Array.from({ length: ANDROID_GRADLE_DISCOVERY_LIMITS.maxTasks + 1 }, (_, index) => `:task${index}`).join("\n");
  assert.match(parseGradleTasksOutput(`Other tasks\n-----------\n${many}`).error, /task list exceeded/u);
});

test("preserves arbitrary bytes through bounded discovery decoding and marks every task non-runnable", () => {
  const bytes = new TextEncoder().encode("Other tasks\n-----------\n:binary - \u0000\n");
  const result = parseGradleTasksOutput(bytes);
  assert.equal(result.status, "ready");
  assert.equal(result.tasks[0].runnable, false);
  assert.equal(result.tasks[0].disabledReason, "Task execution is not enabled yet.");
});

test("accepts a FilesRecovery-scale Gradle task catalog within the output budget", () => {
  const taskCount = 16_000;
  const output = `Tasks runnable from root project 'large'\nOther tasks\n-----------\n${Array.from({ length: taskCount }, (_, index) => `:module:task${index} - Generated task ${index}`).join("\n")}`;
  const result = parseGradleTasksOutput(output);
  assert.equal(result.status, "ready");
  assert.equal(result.tasks.length, taskCount);
});
