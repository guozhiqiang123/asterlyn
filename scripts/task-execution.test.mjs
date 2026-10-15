import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseTaskExecutionReview, parseTaskSessionEvent } from "../src/protocol/task-execution.ts";
import { TaskExecutionController } from "../src/application/tasks/task-execution-controller.ts";
import { TaskExecutionRuntime } from "../src/features/tasks/task-execution-runtime.ts";
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

test("FilesRecovery-scale task output remains complete through terminal delivery", async () => {
  const listeners = [];
  const bridge = {
    native: false,
    readWorkspaceTrust: async () => ({ protocolVersion: 1, workspaceRoot: "/repo", state: "trusted" }),
    setWorkspaceTrust: async (_root, state) => ({ protocolVersion: 1, workspaceRoot: "/repo", state }),
    prepareTaskExecution: async () => review,
    startTaskExecution: async () => ({ protocolVersion: 1, runId: "run-large", reviewId: "review-1", workspaceRoot: "/repo" }),
    cancelTaskExecution: async () => {},
    subscribeTaskSession: async (listener) => { listeners.push(listener); return () => {}; },
  };
  const controller = new TaskExecutionController(bridge);
  controller.activateWorkspace(identity);
  await controller.prepare(identity, { pluginId: "android", providerId: "gradle", taskId: "discover", label: "Gradle", executablePath: "gradlew", args: [] });
  await controller.confirm(identity);
  listeners[0]({ protocolVersion: 1, kind: "status", runId: "run-large", workspaceRoot: "/repo", sequence: 1, status: "running", message: null, exitCode: null });
  const chunk = Buffer.alloc(16 * 1024, 97).toString("base64");
  for (let index = 0; index < 84; index += 1) {
    listeners[0]({ protocolVersion: 1, kind: "output", runId: "run-large", workspaceRoot: "/repo", sequence: index + 2, stream: "stdout", dataBase64: chunk });
  }
  listeners[0]({ protocolVersion: 1, kind: "status", runId: "run-large", workspaceRoot: "/repo", sequence: 86, status: "succeeded", message: null, exitCode: 0 });
  assert.equal(controller.state.outputBytes, 84 * 16 * 1024);
  assert.equal(controller.state.outputTruncated, false);
  assert.equal(controller.state.status, "succeeded");
});

test("task event decoding failures crash and cancel the active run", async () => {
  let streamError;
  let cancelled = 0;
  const bridge = {
    native: false,
    readWorkspaceTrust: async () => ({ protocolVersion: 1, workspaceRoot: "/repo", state: "trusted" }),
    setWorkspaceTrust: async (_root, state) => ({ protocolVersion: 1, workspaceRoot: "/repo", state }),
    prepareTaskExecution: async () => review,
    startTaskExecution: async () => ({ protocolVersion: 1, runId: "run-invalid", reviewId: "review-1", workspaceRoot: "/repo" }),
    cancelTaskExecution: async () => { cancelled += 1; },
    subscribeTaskSession: async (_listener, onError) => { streamError = onError; return () => {}; },
  };
  const controller = new TaskExecutionController(bridge);
  controller.activateWorkspace(identity);
  await controller.prepare(identity, { pluginId: "android", providerId: "gradle", taskId: "discover", label: "Gradle", executablePath: "gradlew", args: [] });
  await controller.confirm(identity);
  streamError(new Error("invalid event"));
  await Promise.resolve();
  assert.equal(controller.state.status, "crashed");
  assert.match(controller.state.error, /could not be decoded.*invalid event/u);
  assert.equal(cancelled, 1);
});

test("task execution reports starting and cancelling immediately and only exposes valid active actions", async () => {
  const listeners = [];
  let finishStart;
  let finishCancel;
  const bridge = {
    native: false,
    readWorkspaceTrust: async () => ({ protocolVersion: 1, workspaceRoot: "/repo", state: "trusted" }),
    setWorkspaceTrust: async (_root, state) => ({ protocolVersion: 1, workspaceRoot: "/repo", state }),
    prepareTaskExecution: async () => review,
    startTaskExecution: async () => new Promise((resolve) => { finishStart = resolve; }),
    cancelTaskExecution: async () => new Promise((resolve) => { finishCancel = resolve; }),
    subscribeTaskSession: async (listener) => { listeners.push(listener); return () => {}; },
  };
  const controller = new TaskExecutionController(bridge);
  controller.activateWorkspace(identity);
  await controller.prepare(identity, { pluginId: "android", providerId: "gradle", taskId: "assembleDebug", label: "assembleDebug", executablePath: "gradlew", args: [] });

  const confirmation = controller.confirm(identity);
  assert.equal(controller.state.status, "starting");
  let html = renderTaskExecutionReview(controller.state, EN_US_TASK_EXECUTION_COPY);
  assert.match(html, /Starting…/u);
  assert.match(html, /data-host-action="confirm"[^>]*disabled[^>]*data-task-execution-action="confirm"/u);

  await Promise.resolve();
  finishStart({ protocolVersion: 1, runId: "run-feedback", reviewId: "review-1", workspaceRoot: "/repo" });
  await confirmation;
  assert.equal(controller.state.status, "queued");
  html = renderTaskExecutionReview(controller.state, EN_US_TASK_EXECUTION_COPY);
  assert.doesNotMatch(html, /data-task-execution-action="confirm"/u);
  assert.doesNotMatch(html, /data-task-execution-action="deny"/u);
  assert.match(html, /data-task-execution-action="cancel"/u);

  const cancellation = controller.cancel(identity);
  assert.equal(controller.state.status, "cancelling");
  html = renderTaskExecutionReview(controller.state, EN_US_TASK_EXECUTION_COPY);
  assert.match(html, /Cancelling…/u);
  assert.match(html, /data-host-action="cancel"[^>]*disabled[^>]*data-task-execution-action="cancel"/u);
  finishCancel();
  await cancellation;
  listeners[0]({ protocolVersion: 1, kind: "status", runId: "run-feedback", workspaceRoot: "/repo", sequence: 1, status: "cancelled", message: null, exitCode: null });
  assert.equal(controller.state.status, "cancelled");
});

test("confirmed execution moves to the Tasks panel while retaining terminal output for reveal", async () => {
  const previous = { document: globalThis.document, HTMLElement: globalThis.HTMLElement };
  class FakeElement {
    isConnected = true;
    focus() {}
  }
  const host = {
    innerHTML: "",
    contains: () => false,
    querySelector(selector) {
      if (selector === ".task-execution-review" && this.innerHTML.includes("task-execution-review")) return {};
      return null;
    },
    replaceChildren() { this.innerHTML = ""; },
  };
  const root = {
    addEventListener: () => undefined,
    matches: () => false,
    querySelector: (selector) => selector === "#task-execution-host" ? host : null,
  };
  globalThis.HTMLElement = FakeElement;
  globalThis.document = { activeElement: null };
  try {
    const listeners = [];
    const bridge = {
      native: false,
      readWorkspaceTrust: async () => ({ protocolVersion: 1, workspaceRoot: "/repo", state: "trusted" }),
      setWorkspaceTrust: async (_root, state) => ({ protocolVersion: 1, workspaceRoot: "/repo", state }),
      prepareTaskExecution: async () => review,
      startTaskExecution: async () => ({ protocolVersion: 1, runId: "run-background", reviewId: "review-1", workspaceRoot: "/repo" }),
      cancelTaskExecution: async () => {},
      subscribeTaskSession: async (listener) => { listeners.push(listener); return () => {}; },
    };
    const controller = new TaskExecutionController(bridge);
    let finish;
    const completion = new Promise((resolve) => { finish = resolve; });
    const runtime = new TaskExecutionRuntime(root, controller, () => EN_US_TASK_EXECUTION_COPY, {
      backgroundAfterStart: () => true,
    });
    runtime.activate(identity);
    await runtime.prepare(identity, { pluginId: "android", providerId: "gradle", taskId: "assembleDebug", label: "assembleDebug", executablePath: "gradlew", args: [] }, finish);
    assert.match(host.innerHTML, /task-execution-review/u);
    await controller.confirm(identity);
    assert.equal(runtime.active, false);
    assert.equal(host.innerHTML, "");
    listeners[0]({ protocolVersion: 1, kind: "status", runId: "run-background", workspaceRoot: "/repo", sequence: 1, status: "running", message: null, exitCode: null });
    listeners[0]({ protocolVersion: 1, kind: "status", runId: "run-background", workspaceRoot: "/repo", sequence: 2, status: "succeeded", message: null, exitCode: 0 });
    assert.equal((await completion).status, "succeeded");
    assert.equal(runtime.reveal("android.gradle:assembleDebug", identity), true);
    assert.match(host.innerHTML, /Succeeded/u);
    runtime.dispose();
  } finally {
    globalThis.document = previous.document;
    globalThis.HTMLElement = previous.HTMLElement;
  }
});

test("background discovery watchdog resolves instead of leaving the provider loading forever", async () => {
  const previous = { document: globalThis.document, HTMLElement: globalThis.HTMLElement };
  class FakeElement { isConnected = true; focus() {} }
  const host = {
    innerHTML: "",
    contains: () => false,
    querySelector(selector) { return selector === ".task-execution-review" && this.innerHTML.includes("task-execution-review") ? {} : null; },
    replaceChildren() { this.innerHTML = ""; },
  };
  const root = {
    addEventListener: () => undefined,
    matches: () => false,
    querySelector: (selector) => selector === "#task-execution-host" ? host : null,
  };
  globalThis.HTMLElement = FakeElement;
  globalThis.document = { activeElement: null };
  try {
    let cancelled = 0;
    const bridge = {
      native: false,
      readWorkspaceTrust: async () => ({ protocolVersion: 1, workspaceRoot: "/repo", state: "trusted" }),
      setWorkspaceTrust: async (_root, state) => ({ protocolVersion: 1, workspaceRoot: "/repo", state }),
      prepareTaskExecution: async () => review,
      startTaskExecution: async () => ({ protocolVersion: 1, runId: "run-timeout", reviewId: "review-1", workspaceRoot: "/repo" }),
      cancelTaskExecution: async () => { cancelled += 1; },
      subscribeTaskSession: async () => () => {},
    };
    const controller = new TaskExecutionController(bridge);
    let finish;
    const completion = new Promise((resolve) => { finish = resolve; });
    const runtime = new TaskExecutionRuntime(root, controller, () => EN_US_TASK_EXECUTION_COPY, {
      backgroundAfterStart: () => true,
      executionTimeoutMs: () => 5,
    });
    runtime.activate(identity);
    await runtime.prepare(identity, { pluginId: "android", providerId: "gradle", taskId: "discover", label: "Gradle", executablePath: "gradlew", args: [] }, finish);
    await controller.confirm(identity);
    const result = await completion;
    assert.equal(result.status, "crashed");
    assert.match(result.error, /timed out/u);
    assert.equal(cancelled, 1);
    runtime.dispose();
  } finally {
    globalThis.document = previous.document;
    globalThis.HTMLElement = previous.HTMLElement;
  }
});

test("accepted cancellation releases background discovery without waiting for a terminal event", async () => {
  const previous = { document: globalThis.document, HTMLElement: globalThis.HTMLElement };
  class FakeElement { isConnected = true; focus() {} }
  const host = {
    innerHTML: "",
    contains: () => false,
    querySelector(selector) { return selector === ".task-execution-review" && this.innerHTML.includes("task-execution-review") ? {} : null; },
    replaceChildren() { this.innerHTML = ""; },
  };
  const root = {
    addEventListener: () => undefined,
    matches: () => false,
    querySelector: (selector) => selector === "#task-execution-host" ? host : null,
  };
  globalThis.HTMLElement = FakeElement;
  globalThis.document = { activeElement: null };
  try {
    let cancelled = 0;
    const bridge = {
      native: false,
      readWorkspaceTrust: async () => ({ protocolVersion: 1, workspaceRoot: "/repo", state: "trusted" }),
      setWorkspaceTrust: async (_root, state) => ({ protocolVersion: 1, workspaceRoot: "/repo", state }),
      prepareTaskExecution: async () => review,
      startTaskExecution: async () => ({ protocolVersion: 1, runId: `run-cancel-${cancelled}`, reviewId: "review-1", workspaceRoot: "/repo" }),
      cancelTaskExecution: async () => { cancelled += 1; },
      subscribeTaskSession: async () => () => {},
    };
    const controller = new TaskExecutionController(bridge);
    const runtime = new TaskExecutionRuntime(root, controller, () => EN_US_TASK_EXECUTION_COPY, {
      backgroundAfterStart: () => true,
      executionTimeoutMs: () => 120_000,
    });
    runtime.activate(identity);
    let finishFirst;
    const first = new Promise((resolve) => { finishFirst = resolve; });
    await runtime.prepare(identity, { pluginId: "android", providerId: "gradle", taskId: "discover", label: "Gradle", executablePath: "gradlew", args: [] }, finishFirst);
    await controller.confirm(identity);
    await runtime.cancel(identity);
    assert.equal((await first).status, "cancelled");
    assert.equal(controller.state.status, "cancelled");
    assert.equal(cancelled, 1);

    let finishSecond;
    await runtime.prepare(identity, { pluginId: "android", providerId: "gradle", taskId: "discover", label: "Gradle", executablePath: "gradlew", args: [] }, (result) => { finishSecond = result; });
    assert.equal(controller.state.status, "review");
    runtime.dispose();
    assert.equal(finishSecond.status, "cancelled");
  } finally {
    globalThis.document = previous.document;
    globalThis.HTMLElement = previous.HTMLElement;
  }
});

test("cancelling while start is pending dismisses the review and cleans up the eventual native run", async () => {
  let finishStart;
  let cancelledRun = null;
  let released = 0;
  const bridge = {
    native: false,
    readWorkspaceTrust: async () => ({ protocolVersion: 1, workspaceRoot: "/repo", state: "trusted" }),
    setWorkspaceTrust: async (_root, state) => ({ protocolVersion: 1, workspaceRoot: "/repo", state }),
    prepareTaskExecution: async () => review,
    startTaskExecution: async () => new Promise((resolve) => { finishStart = resolve; }),
    cancelTaskExecution: async (runId) => { cancelledRun = runId; },
    subscribeTaskSession: async () => () => { released += 1; },
  };
  const controller = new TaskExecutionController(bridge);
  controller.activateWorkspace(identity);
  await controller.prepare(identity, { pluginId: "android", providerId: "gradle", taskId: "assembleDebug", label: "assembleDebug", executablePath: "gradlew", args: [] });

  const confirmation = controller.confirm(identity);
  assert.equal(controller.state.status, "starting");
  await controller.cancel(identity);
  assert.equal(controller.state.status, "idle");
  finishStart({ protocolVersion: 1, runId: "run-late", reviewId: "review-1", workspaceRoot: "/repo" });
  await assert.rejects(confirmation, /stale/u);
  assert.equal(cancelledRun, "run-late");
  assert.equal(released, 1);
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

test("a late prepare response cannot replace a newer review in the same workspace", async () => {
  const pending = [];
  const bridge = {
    native: false,
    readWorkspaceTrust: async () => ({ protocolVersion: 1, workspaceRoot: "/repo", state: "trusted" }),
    setWorkspaceTrust: async (_root, state) => ({ protocolVersion: 1, workspaceRoot: "/repo", state }),
    prepareTaskExecution: async () => new Promise((resolve) => pending.push(resolve)),
    startTaskExecution: async () => { throw new Error("not used"); },
    cancelTaskExecution: async () => {},
    subscribeTaskSession: async () => () => {},
  };
  const controller = new TaskExecutionController(bridge);
  controller.activateWorkspace(identity);
  const first = controller.prepare(identity, { pluginId: "android", providerId: "gradle", taskId: "first", label: "first", executablePath: "gradlew", args: [] });
  const second = controller.prepare(identity, { pluginId: "android", providerId: "gradle", taskId: "second", label: "second", executablePath: "gradlew", args: [] });
  pending[1]({ ...review, reviewId: "review-2", taskId: "second", label: "second" });
  await second;
  pending[0]({ ...review, taskId: "first", label: "first" });
  await assert.rejects(first, /stale/u);
  assert.equal(controller.state.review.taskId, "second");
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
  assert.match(html, /class="dialog task-execution-review"/u);
  assert.match(html, /\/repo\/gradlew/);
  assert.match(html, /data-task-execution-action="trust"/);
  assert.match(html, /data-task-execution-action="deny"/);
  assert.match(html, /class="danger-button"[^>]*data-task-execution-action="deny"/u);
  assert.match(html, /class="primary-button"[^>]*data-task-execution-action="trust"/u);
  assert.match(html, /Do not trust workspace/u);
  assert.match(html, /€/u);
  assert.doesNotMatch(html, /�/u);
  assert.match(html, /&lt;script&gt;/u);
  assert.match(html, /Output was truncated/);
  assert.doesNotMatch(html, /<script>/u);
});

test("terminal execution UI keeps errors and exposes retry and close output", () => {
  const html = renderTaskExecutionReview({
    status: "failed", identity, review, runId: "run-terminal", outputs: [], outputBytes: 0,
    outputTruncated: false, error: "Gradle failed", lastSequence: 2,
  }, EN_US_TASK_EXECUTION_COPY);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Gradle failed/);
  assert.match(html, /data-task-execution-action="retry"/);
  assert.match(html, /data-task-execution-action="close"/);
  assert.match(html, /class="primary-button"[^>]*data-task-execution-action="retry"/u);
  assert.doesNotMatch(html, /data-task-execution-action="confirm"/);
});

test("host failures become dismissible terminal state without losing workspace identity", async () => {
  const bridge = {
    native: false,
    readWorkspaceTrust: async () => ({ protocolVersion: 1, workspaceRoot: "/repo", state: "trusted" }),
    setWorkspaceTrust: async (_root, state) => ({ protocolVersion: 1, workspaceRoot: "/repo", state }),
    prepareTaskExecution: async () => review,
    startTaskExecution: async () => { throw new Error("a task is already running for this workspace"); },
    cancelTaskExecution: async () => {},
    subscribeTaskSession: async () => () => {},
  };
  const controller = new TaskExecutionController(bridge);
  controller.activateWorkspace(identity);
  await controller.prepare(identity, { pluginId: "android", providerId: "gradle", taskId: "assembleDebug", label: "assembleDebug", executablePath: "gradlew", args: [] });
  await assert.rejects(controller.confirm(identity), /already running/);
  controller.fail(identity, new Error("a task is already running for this workspace"));
  assert.equal(controller.state.status, "crashed");
  controller.dismiss(identity);
  assert.equal(controller.state.status, "idle");
  assert.deepEqual(controller.state.identity, identity);
});

test("task review runtime owns escape, focus trap, and focus restoration", async () => {
  const source = await readFile(
    new URL("../src/features/tasks/task-execution-runtime.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /event\.key === "Escape"/u);
  assert.match(source, /if \(host\) trapFocus\(host, event\)/u);
  assert.match(source, /this\.focusReturn = document\.activeElement/u);
  assert.match(source, /target\?\.isConnected/u);
  assert.match(source, /querySelector<HTMLElement>\("#task-execution-host"\)/u);
  assert.match(source, /backgroundStartedExecution\(state\)/u);
  assert.doesNotMatch(source, /\?\? root/u);
});
