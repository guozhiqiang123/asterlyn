import assert from "node:assert/strict";
import test from "node:test";

import {
  parseTaskArtifactDiscovery,
  TASK_ARTIFACT_LIMITS,
  validTaskArtifactHint,
  validTaskArtifactHints,
} from "../src/protocol/task-artifacts.ts";
import { taskArtifactAttachmentMatches } from "../src/features/tasks/task-execution-runtime.ts";
import { renderTaskExecutionReview } from "../src/features/tasks/task-execution-view.ts";
import { EN_US_TASK_EXECUTION_COPY } from "../src/localization/task-execution-copy.ts";

const artifact = (workspacePath, kind = "apk", byteLength = 12) => ({ workspacePath, kind, byteLength });
const discovery = (artifacts, extra = {}) => ({ protocolVersion: 1, workspaceRoot: "/repo", artifacts, truncated: false, ...extra });

test("artifact discovery parser accepts bounded sorted workspace-relative results", () => {
  const value = discovery([
    artifact("app/build/outputs/apk/debug/app-debug.apk"),
    artifact("app/build/outputs/bundle/release/app-release.aab", "aab", 1_024),
  ], { truncated: true });
  assert.deepEqual(parseTaskArtifactDiscovery(value), value);
});

test("artifact discovery parser fails closed on unsafe, duplicate, and oversized results", () => {
  assert.throws(() => parseTaskArtifactDiscovery({ ...discovery([]), protocolVersion: 2 }), /protocol version/u);
  assert.throws(() => parseTaskArtifactDiscovery(discovery([artifact("../escape.apk")])), /invalid component/u);
  assert.throws(() => parseTaskArtifactDiscovery(discovery([artifact("app\\escape.apk")])), /normalized relative/u);
  assert.throws(() => parseTaskArtifactDiscovery(discovery([artifact("app.aab", "apk")])), /does not match/u);
  assert.deepEqual(parseTaskArtifactDiscovery(discovery([artifact("b.apk"), artifact("a.apk")])).artifacts.map((item) => item.workspacePath), ["a.apk", "b.apk"]);
  assert.throws(() => parseTaskArtifactDiscovery(discovery([artifact("a.apk"), artifact("a.apk")])), /unique/u);
  assert.throws(() => parseTaskArtifactDiscovery(discovery([artifact("a.apk", "apk", TASK_ARTIFACT_LIMITS.maxFileBytes + 1)])), /byteLength/u);
  assert.throws(() => parseTaskArtifactDiscovery(discovery(Array.from({ length: 65 }, (_, index) => artifact(`a${index}.apk`)))), /result limit/u);
});

test("artifact hints allow only bounded Gradle output directories", () => {
  assert.equal(validTaskArtifactHint("build/outputs/apk"), true);
  assert.equal(validTaskArtifactHint("features/demo/build/outputs/bundle"), true);
  for (const hint of ["/build/outputs/apk", "../build/outputs/apk", "app//build/outputs/apk", "C:/build/outputs/apk", "app/build/outputs/reports"]) {
    assert.equal(validTaskArtifactHint(hint), false, hint);
  }
  assert.equal(validTaskArtifactHints([]), false);
  assert.equal(validTaskArtifactHints(Array.from({ length: 9 }, () => "app/build/outputs/apk")), false);
});

test("artifact attachment survives background execution and rejects stale workspace, task, and dismissal generation", () => {
  const target = { root: "/repo", generation: 3, taskKey: "android.gradle::app:assembleDebug", presentationVersion: 7 };
  const current = { identity: { root: "/repo", generation: 3 }, taskKey: target.taskKey, presentationVersion: 7, visible: true, succeeded: true };
  assert.equal(taskArtifactAttachmentMatches(target, current), true);
  assert.equal(taskArtifactAttachmentMatches(target, { ...current, identity: { root: "/other", generation: 3 } }), false);
  assert.equal(taskArtifactAttachmentMatches(target, { ...current, taskKey: "android.gradle::app:assembleRelease" }), false);
  assert.equal(taskArtifactAttachmentMatches(target, { ...current, presentationVersion: 8 }), false);
  assert.equal(taskArtifactAttachmentMatches(target, { ...current, visible: false }), true);
});

test("successful task UI renders escaped bounded artifacts and Reveal actions", () => {
  const state = {
    status: "succeeded", identity: { root: "/repo", generation: 3 }, runId: "run", outputs: [], outputBytes: 0,
    outputTruncated: false, error: null, lastSequence: 2,
    review: { protocolVersion: 1, reviewId: "review", workspaceRoot: "/repo", pluginId: "android", providerId: "gradle", taskId: ":app:assembleDebug", label: "assembleDebug", executablePath: "gradlew", canonicalExecutablePath: "/repo/gradlew", args: [":app:assembleDebug"], cwd: "/repo", trust: "trusted" },
  };
  const html = renderTaskExecutionReview(state, EN_US_TASK_EXECUTION_COPY, { status: "ready", discovery: discovery([artifact("app/build/outputs/apk/debug/<app>.apk")], { truncated: true }) });
  assert.match(html, /Build artifacts/u);
  assert.match(html, /&lt;app&gt;\.apk/u);
  assert.match(html, /data-task-execution-action="reveal-artifact"/u);
  assert.match(html, /data-task-artifact-index="0"/u);
  assert.match(html, /Artifact results were truncated/u);
  assert.doesNotMatch(html, /<app>/u);
});
