import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseTaskExecutionReview, parseTaskSessionEvent } from "../src/protocol/task-execution.ts";
import { TaskExecutionController } from "../src/application/tasks/task-execution-controller.ts";
import { renderTaskExecutionReview } from "../src/features/tasks/task-execution-view.ts";
import { EN_US_TASK_EXECUTION_COPY } from "../src/localization/task-execution-copy.ts";

const identity = { root: "/repo", generation: 3 };
const review = { protocolVersion: 1, reviewId: "review-1", workspaceRoot: "/repo", pluginId: "android", providerId: "gradle", taskId: "assembleDebug", label: "assembleDebug", executablePath: "gradlew", canonicalExecutablePath: "/repo/gradlew", args: ["assembleDebug"], cwd: "/repo", trust: "trusted" };

test("task wire parsers require protocol version and bounded event fields", () => {
  assert.deepEqual(parseTaskExecutionReview(review), review);
  assert.throws(() => parseTaskExecutionReview({ ...review, protocolVersion: 2 }), /protocol version/);
  assert.throws(() => parseTaskExecutionReview({ ...review, canonicalExecutablePath: undefined }), /canonicalExecutablePath/);
  assert.deepEqual(parseTaskSessionEvent({ protocolVersion: 1, kind: "output", runId: "run", workspaceRoot: "/repo", sequence: 1, stream: "stdout", dataBase64: "aGk=" }).stream, "stdout");
  assert.throws(() => parseTaskSessionEvent({ protocolVersion: 1, kind: "output", runId: "run", workspaceRoot: "/repo", sequence: 1, stream: "stdout", dataBase64: "" }), /dataBase64/);
});

test("task execution requires a reviewed trusted workspace and rejects stale events", async () => {
  const events = [];
  const bridge = {
    native: false,
    readWorkspaceTrust: async () => ({ protocolVersion: 1, workspaceRoot: "/repo", state: "trusted" }),
    setWorkspaceTrust: async (_root, state) => ({ protocolVersion: 1, workspaceRoot: "/repo", state }),
    prepareTaskExecution: async () => review,
    startTaskExecution: async () => ({ protocolVersion: 1, runId: "run-1", reviewId: "review-1", workspaceRoot: "/repo" }),
    cancelTaskExecution: async () => {},
    subscribeTaskSession: async (listener) => { events.push(listener); return () => {}; },
  };
  const controller = new TaskExecutionController(bridge);
  controller.activateWorkspace(identity);
  await controller.prepare(identity, { pluginId: "android", providerId: "gradle", taskId: "assembleDebug", label: "assembleDebug", executablePath: "gradlew", args: ["assembleDebug"] });
  await controller.confirm(identity);
  assert.equal(controller.state.status, "queued");
  events[0]({ protocolVersion: 1, kind: "status", runId: "run-1", workspaceRoot: "/repo", sequence: 1, status: "running", message: null, exitCode: null });
  events[0]({ protocolVersion: 1, kind: "output", runId: "old", workspaceRoot: "/repo", sequence: 2, stream: "stdout", dataBase64: "YmFk" });
  events[0]({ protocolVersion: 1, kind: "status", runId: "run-1", workspaceRoot: "/repo", sequence: 1, status: "failed", message: "stale", exitCode: 1 });
  assert.equal(controller.state.status, "running");
  controller.activateWorkspace({ root: "/other", generation: 4 });
  events[0]({ protocolVersion: 1, kind: "status", runId: "run-1", workspaceRoot: "/repo", sequence: 2, status: "succeeded", message: null, exitCode: 0 });
  assert.equal(controller.state.status, "idle");
});

test("trust actions preserve review, review cancel dismisses, and terminal events release subscription", async () => {
  const listeners = [];
  let released = 0;
  let cancelled = 0;
  const bridge = {
    native: false,
    readWorkspaceTrust: async () => ({ protocolVersion: 1, workspaceRoot: "/repo", state: "unknown" }),
    setWorkspaceTrust: async (_root, state) => ({ protocolVersion: 1, workspaceRoot: "/repo", state }),
    prepareTaskExecution: async () => ({ ...review, trust: "unknown" }),
    startTaskExecution: async () => ({ protocolVersion: 1, runId: "run-2", reviewId: "review-1", workspaceRoot: "/repo" }),
    cancelTaskExecution: async () => { cancelled += 1; },
    subscribeTaskSession: async (listener) => { listeners.push(listener); return () => { released += 1; }; },
  };
  const controller = new TaskExecutionController(bridge);
  controller.activateWorkspace(identity);
  await controller.prepare(identity, { pluginId: "android", providerId: "gradle", taskId: "assembleDebug", label: "assembleDebug", executablePath: "gradlew", args: [] });
  await controller.setWorkspaceTrust(identity, "trusted");
  assert.equal(controller.state.status, "review");
  assert.equal(controller.state.review.trust, "trusted");
  await controller.cancel(identity);
  assert.equal(controller.state.status, "idle");
  await controller.prepare(identity, { pluginId: "android", providerId: "gradle", taskId: "assembleDebug", label: "assembleDebug", executablePath: "gradlew", args: [] });
  await controller.setWorkspaceTrust(identity, "trusted");
  await controller.confirm(identity);
  listeners[0]({ protocolVersion: 1, kind: "status", runId: "run-2", workspaceRoot: "/repo", sequence: 1, status: "succeeded", message: null, exitCode: 0 });
  assert.equal(controller.state.status, "succeeded");
  assert.equal(released, 1);
  assert.equal(cancelled, 0);
});

test("sequence gaps crash the run and cancel native work, while stale start cleanup is best effort", async () => {
  const listeners = [];
  let cancelled = 0;
  const bridge = {
    native: false,
    readWorkspaceTrust: async () => ({ protocolVersion: 1, workspaceRoot: "/repo", state: "trusted" }),
    setWorkspaceTrust: async (_root, state) => ({ protocolVersion: 1, workspaceRoot: "/repo", state }),
    prepareTaskExecution: async () => review,
    startTaskExecution: async () => ({ protocolVersion: 1, runId: "run-3", reviewId: "review-1", workspaceRoot: "/repo" }),
    cancelTaskExecution: async () => { cancelled += 1; },
    subscribeTaskSession: async (listener) => { listeners.push(listener); return () => {}; },
  };
  const controller = new TaskExecutionController(bridge);
  controller.activateWorkspace(identity);
  await controller.prepare(identity, { pluginId: "android", providerId: "gradle", taskId: "assembleDebug", label: "assembleDebug", executablePath: "gradlew", args: [] });
  await controller.confirm(identity);
  listeners[0]({ protocolVersion: 1, kind: "status", runId: "run-3", workspaceRoot: "/repo", sequence: 2, status: "running", message: null, exitCode: null });
  assert.equal(controller.state.status, "crashed");
  assert.equal(cancelled, 1);
});

test("start response from a superseded activation is cancelled and unsubscribed", async () => {
  let controller;
  let cancelled = 0;
  let released = 0;
  const bridge = {
    native: false,
    readWorkspaceTrust: async () => ({ protocolVersion: 1, workspaceRoot: "/repo", state: "trusted" }),
    setWorkspaceTrust: async (_root, state) => ({ protocolVersion: 1, workspaceRoot: "/repo", state }),
    prepareTaskExecution: async () => review,
    startTaskExecution: async () => { controller.activateWorkspace({ root: "/new", generation: 4 }); return { protocolVersion: 1, runId: "run-stale", reviewId: "review-1", workspaceRoot: "/repo" }; },
    cancelTaskExecution: async () => { cancelled += 1; },
    subscribeTaskSession: async () => () => { released += 1; },
  };
  controller = new TaskExecutionController(bridge);
  controller.activateWorkspace(identity);
  await controller.prepare(identity, { pluginId: "android", providerId: "gradle", taskId: "assembleDebug", label: "assembleDebug", executablePath: "gradlew", args: [] });
  await assert.rejects(controller.confirm(identity), /stale/);
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
});

test("clear and dispose clean up active native runs and subscriptions", async () => {
  let cancelled = 0;
  let released = 0;
  const bridge = {
    native: false,
    readWorkspaceTrust: async () => ({ protocolVersion: 1, workspaceRoot: "/repo", state: "trusted" }),
    setWorkspaceTrust: async (_root, state) => ({ protocolVersion: 1, workspaceRoot: "/repo", state }),
    prepareTaskExecution: async () => review,
    startTaskExecution: async () => ({ protocolVersion: 1, runId: `run-${cancelled}`, reviewId: "review-1", workspaceRoot: "/repo" }),
    cancelTaskExecution: async () => { cancelled += 1; },
    subscribeTaskSession: async () => () => { released += 1; },
  };
  const controller = new TaskExecutionController(bridge);
  controller.activateWorkspace(identity);
  await controller.prepare(identity, { pluginId: "android", providerId: "gradle", taskId: "assembleDebug", label: "assembleDebug", executablePath: "gradlew", args: [] });
  await controller.confirm(identity);
  controller.clear();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelled, 1);
  assert.equal(released, 1);

  controller.activateWorkspace(identity);
  await controller.prepare(identity, { pluginId: "android", providerId: "gradle", taskId: "assembleDebug", label: "assembleDebug", executablePath: "gradlew", args: [] });
  await controller.confirm(identity);
  controller.dispose();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelled, 2);
  assert.equal(released, 2);
});

test("review UI shows canonical executable, trust actions, ARIA, and merged UTF-8 output", () => {
  const state = {
    status: "review", identity, review: { ...review, trust: "unknown" }, runId: null,
    outputs: [{ stream: "stdout", dataBase64: "4g==" }, { stream: "stdout", dataBase64: "gqw=" }, { stream: "stderr", dataBase64: "PHNjcmlwdD4=" }],
    outputBytes: 11, outputTruncated: true, error: null, lastSequence: 3,
  };
  const html = renderTaskExecutionReview(state, EN_US_TASK_EXECUTION_COPY);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /\/repo\/gradlew/);
  assert.match(html, /data-task-execution-action="trust"/);
  assert.match(html, /data-task-execution-action="deny"/);
  assert.match(html, /€/u);
  assert.doesNotMatch(html, /�/u);
  assert.match(html, /&lt;script&gt;/u);
  assert.match(html, /Output was truncated/);
  assert.doesNotMatch(html, /<script>/u);
});

test("task review runtime owns escape, focus trap, and focus restoration", async () => {
  const source = await readFile(
    new URL("../src/features/tasks/task-execution-runtime.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /event\.key === "Escape"/u);
  assert.match(source, /trapFocus\(this\.host, event\)/u);
  assert.match(source, /this\.focusReturn = document\.activeElement/u);
  assert.match(source, /target\.isConnected && target\.focus\(\)/u);
});
