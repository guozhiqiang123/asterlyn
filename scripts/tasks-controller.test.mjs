import assert from "node:assert/strict";
import test from "node:test";

import { TasksController } from "../src/features/tasks/tasks-controller.ts";

const identity = { root: "/project", generation: 3 };
const ready = (tasks) => ({ status: "ready", tasks });
const task = (id, label, group = "Build", extra = {}) => ({ id, label, group, runnable: true, ...extra });

test("controller binds providers to the active workspace identity and aggregates groups", () => {
  const controller = new TasksController();
  controller.activate(identity);
  assert.equal(controller.acceptProviders(identity, [
    { id: "android", label: "Android", snapshot: ready([task("assemble", "assembleDebug")]) },
    { id: "quality", label: "Quality", snapshot: ready([task("check", "check", "Verify")]) },
  ]), true);
  assert.equal(controller.state.status, "ready");
  assert.deepEqual(controller.state.entries.map((entry) => entry.key), ["android:assemble", "quality:check"]);
  assert.equal(controller.selectedTask().task.label, "assembleDebug");
});

test("stale workspace and generation results are rejected", () => {
  const controller = new TasksController();
  controller.activate(identity);
  controller.acceptProviders(identity, [{ id: "p", label: "P", snapshot: ready([task("one", "one")]) }]);
  const next = { root: "/project", generation: 4 };
  controller.activate(next);
  assert.equal(controller.acceptProviders(identity, [{ id: "p", label: "P", snapshot: ready([task("old", "old")]) }]), false);
  assert.deepEqual(controller.state.entries, []);
});

test("selection is stable across provider updates and query filters", () => {
  const controller = new TasksController();
  controller.activate(identity);
  const providers = [{ id: "p", label: "P", snapshot: ready([
    task("a", "assemble"), task("b", "bundle"), task("c", "check", "Verify"),
  ]) }];
  controller.acceptProviders(identity, providers);
  controller.selectKey("p:b");
  controller.acceptProviders(identity, [{ id: "p", label: "P", snapshot: ready([
    task("a", "assemble"), task("b", "bundle"), task("c", "check", "Verify"),
  ]) }]);
  assert.equal(controller.selectedTask().key, "p:b");
  controller.setQuery("verify");
  assert.equal(controller.selectedTask().key, "p:c");
  assert.equal(controller.moveSelection(1), false);
  controller.setQuery("");
  assert.equal(controller.select(99), false);
});

test("provider statuses expose loading, unavailable, error, and empty states", () => {
  const controller = new TasksController();
  controller.activate(identity);
  assert.equal(controller.state.status, "empty");
  controller.acceptProviders(identity, [{ id: "p", label: "P", snapshot: { status: "loading", tasks: [] } }]);
  assert.equal(controller.state.status, "loading");
  controller.acceptProviders(identity, [{ id: "p", label: "P", snapshot: { status: "unavailable", tasks: [], unavailableReason: "workspace-untrusted" } }]);
  assert.equal(controller.state.status, "unavailable");
  assert.equal(controller.state.unavailableReason, "workspace-untrusted");
  controller.acceptProviders(identity, [{ id: "p", label: "P", snapshot: { status: "error", tasks: [], error: "failed" } }]);
  assert.equal(controller.state.status, "error");
  assert.equal(controller.state.error, "failed");
});

test("loading and failed refreshes retain the last discovered task projection", () => {
  const controller = new TasksController();
  controller.activate(identity);
  const retained = task("assemble", "assembleDebug");
  controller.acceptProviders(identity, [{ id: "p", label: "Gradle", snapshot: { status: "loading", tasks: [retained] } }]);
  assert.equal(controller.state.status, "loading");
  assert.deepEqual(controller.state.entries.map((entry) => entry.task.id), ["assemble"]);
  controller.acceptProviders(identity, [{ id: "p", label: "Gradle", snapshot: { status: "error", tasks: [retained], error: "refresh failed" } }]);
  assert.equal(controller.state.status, "error");
  assert.deepEqual(controller.state.visibleEntries.map((entry) => entry.task.id), ["assemble"]);
});

test("controller clones provider projections and caps queries", () => {
  const controller = new TasksController();
  controller.activate(identity);
  const tasks = [task("one", "one")];
  const provider = { id: "p", label: "P", snapshot: ready(tasks) };
  controller.acceptProviders(identity, [provider]);
  tasks[0].label = "mutated";
  provider.label = "mutated provider";
  assert.equal(controller.state.entries[0].task.label, "one");
  controller.setQuery("x".repeat(300));
  assert.equal(controller.state.query.length, 256);
});

test("malformed and duplicate provider projections are isolated", () => {
  const controller = new TasksController();
  controller.activate(identity);
  assert.doesNotThrow(() => controller.acceptProviders(identity, [
    { id: "bad", label: "Bad", snapshot: { status: "ready", tasks: null } },
    { id: "bad", label: "Duplicate", snapshot: ready([task("ignored", "ignored")]) },
    { id: "good", label: "Good", snapshot: ready([task("ok", "ok")]) },
    { id: "invalid-task", label: "Invalid", snapshot: ready([{ id: "x", label: "x", group: "x" }]) },
  ]));
  assert.equal(controller.state.status, "ready");
  assert.deepEqual(controller.state.providers.map((provider) => provider.id), ["bad", "good", "invalid-task"]);
  assert.deepEqual(controller.state.entries.map((entry) => entry.key), ["good:ok"]);
  assert.equal(controller.state.providers[0].snapshot.status, "error");
});

test("controller preserves only bounded known task run states", () => {
  const controller = new TasksController();
  controller.activate(identity);
  controller.acceptProviders(identity, [{ id: "p", label: "P", snapshot: ready([
    task("running", "running", "Build", { runState: "running" }),
    task("invalid", "invalid", "Build", { runState: "invented" }),
  ]) }]);
  assert.equal(controller.state.entries[0].task.runState, "running");
  assert.equal(controller.state.entries[1].task.runState, undefined);
});

test("controller normalizes cache metadata, retains stale tasks, and disables execution", () => {
  const controller = new TasksController();
  controller.activate(identity);
  controller.acceptProviders(identity, [{ id: "gradle", label: "Gradle", snapshot: {
    status: "ready", cache: { status: "stale", staleReason: "fingerprint-mismatch", restoredTaskCount: 1 },
    tasks: [task("assemble", "assembleDebug")],
  } }]);
  assert.deepEqual(controller.state.providers[0].snapshot.cache, { status: "stale", staleReason: "fingerprint-mismatch", restoredTaskCount: 1 });
  assert.deepEqual(controller.state.entries.map((entry) => entry.task.id), ["assemble"]);
  assert.equal(controller.state.entries[0].task.runnable, false);
  controller.acceptProviders(identity, [{ id: "gradle", label: "Gradle", snapshot: {
    status: "ready", cache: { status: "stale", staleReason: "invented", restoredTaskCount: 999999 },
    tasks: [task("assemble", "assembleDebug")],
  } }]);
  assert.equal(controller.state.providers[0].snapshot.cache, undefined);
  assert.equal(controller.state.entries[0].task.runnable, true);
});

test("controller preserves valid Gradle project paths and filters by module", () => {
  const controller = new TasksController();
  controller.activate(identity);
  controller.acceptProviders(identity, [{ id: "gradle", label: "Gradle", snapshot: ready([
    task(":app:assembleDebug", ":app:assembleDebug", "Build tasks", { projectPath: ":app" }),
    task(":bad:assembleDebug", ":bad:assembleDebug", "Build tasks", { projectPath: "../bad" }),
  ]) }]);
  assert.equal(controller.state.entries[0].task.projectPath, ":app");
  assert.equal(controller.state.entries[1].task.projectPath, undefined);
  controller.setQuery(":app");
  assert.deepEqual(controller.state.visibleEntries.map((entry) => entry.task.id), [":app:assembleDebug"]);
});

test("controller retains only collections whose task leaves join the normalized snapshot", () => {
  const controller = new TasksController();
  controller.activate(identity);
  const collection = {
    providerId: "gradle", source: "contributed", truncated: false,
    nodes: [
      { id: "root", parentId: null, label: "Tasks", kind: "group", order: 0, depth: 0 },
      { id: "leaf", parentId: "root", label: "assemble", kind: "task", order: 0, depth: 1, taskId: ":app:assemble" },
    ],
  };
  controller.acceptProviders(identity, [{ id: "gradle", label: "Gradle", snapshot: ready([
    task(":app:assemble", "assemble", "Build"),
  ]), collection }]);
  assert.deepEqual(controller.state.providers[0].collection, collection);
  controller.acceptProviders(identity, [{ id: "gradle", label: "Gradle", snapshot: ready([
    task(":app:assemble", "assemble", "Build"),
  ]), collection: { ...collection, nodes: [{ ...collection.nodes[1], taskId: ":missing" }] } }]);
  assert.equal(controller.state.providers[0].collection, undefined);
  assert.deepEqual(controller.state.entries.map((entry) => entry.task.id), [":app:assemble"]);
});

test("controller retains a FilesRecovery-scale provider catalog for full-text filtering", () => {
  const controller = new TasksController();
  controller.activate(identity);
  const tasks = Array.from({ length: 16_000 }, (_, index) => task(`:module:task${index}`, `task${index}`));
  controller.acceptProviders(identity, [{ id: "gradle", label: "Gradle", snapshot: ready(tasks) }]);
  assert.equal(controller.state.entries.length, tasks.length);
  controller.setQuery("task15999");
  assert.deepEqual(controller.state.visibleEntries.map((entry) => entry.task.id), [":module:task15999"]);
});
