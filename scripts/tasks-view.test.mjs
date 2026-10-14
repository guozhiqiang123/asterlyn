import assert from "node:assert/strict";
import test from "node:test";

import { renderTasksView } from "../src/features/tasks/tasks-view.ts";

const copy = {
  title: "Tasks", refresh: "Refresh", empty: "Empty", unavailable: "Unavailable", loading: "Loading", cancelDiscovery: "Cancel discovery", retryDiscovery: "Retry discovery", discovered: (count) => `${count} discovered`, providerLoading: (provider) => `Discovering ${provider}`,
  unavailableReasons: {
    "discovery-not-supported": "Not supported",
    "evidence-incomplete": "Incomplete evidence",
    "workspace-untrusted": "Untrusted workspace",
  },
  error: "Error", noResults: "No results", queryPlaceholder: "Filter", run: "Run", retry: "Retry", revealOutput: "Reveal", notRunnable: "Disabled", androidQuickActions: "Quick actions", quickActionKinds: { assemble: "Assemble", bundle: "Bundle", install: "Install", uninstall: "Uninstall" }, quickActionModule: "Module", quickActionVariant: "Variant", status: { failed: "Failed" },
};

test("Tasks view renders accessible grouped declarative rows and escapes content", () => {
  const html = renderTasksView({
    identity: { root: "/project", generation: 1 }, status: "ready", providers: [],
    entries: [{ key: "p:1", providerId: "p", providerLabel: "P", task: {
      id: "1", label: "build <debug>", group: "Build & Test", description: "Run \"debug\"", runnable: true,
    } }],
    visibleEntries: [{ key: "p:1", providerId: "p", providerLabel: "P", task: {
      id: "1", label: "build <debug>", group: "Build & Test", description: "Run \"debug\"", runnable: true,
    } }],
    query: "", selectedIndex: 0, error: null, unavailableReason: null,
  }, copy);
  assert.match(html, /role="region"/);
  assert.match(html, /role="listbox"/);
  assert.match(html, /role="option"/);
  assert.match(html, /build &lt;debug&gt;/);
  assert.match(html, /Run &quot;debug&quot;/);
  assert.match(html, /aria-selected="true"/);
});

test("Tasks view renders all non-ready states without task rows", () => {
  for (const status of ["empty", "unavailable", "loading", "error"]) {
    const html = renderTasksView({
      identity: null, status, providers: [], entries: [], visibleEntries: [], query: "", selectedIndex: 0,
      error: status === "error" ? "boom" : null,
      unavailableReason: status === "unavailable" ? "evidence-incomplete" : null,
    }, copy);
    assert.match(html, status === "error" ? /role="alert"/ : /role="status"/);
    assert.doesNotMatch(html, /role="option"/);
  }
});

test("unavailable reasons render localized copy instead of internal enum codes", () => {
  const html = renderTasksView({
    identity: null, status: "unavailable", providers: [], entries: [], visibleEntries: [], query: "", selectedIndex: 0,
    error: null, unavailableReason: "workspace-untrusted",
  }, copy);
  assert.match(html, /Untrusted workspace/);
  assert.doesNotMatch(html, /workspace-untrusted/);
});

test("loading discovery renders provider progress and a cancel action", () => {
  const html = renderTasksView({
    identity: { root: "/project", generation: 1 }, status: "loading", providers: [{ id: "gradle", label: "Gradle", snapshot: { status: "loading", tasks: [] } }], entries: [], visibleEntries: [], query: "", selectedIndex: 0, error: null, unavailableReason: null,
  }, copy);
  assert.match(html, /data-tasks-discovery-state="loading"/);
  assert.match(html, /Discovering Gradle/);
  assert.match(html, /data-tasks-action="cancel"/);
  assert.match(html, /tasks-spinner/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /data-tasks-action="refresh"[^>]*disabled/u);
});

test("failed discovery renders the error detail and retry action", () => {
  const html = renderTasksView({
    identity: { root: "/project", generation: 1 }, status: "error", providers: [{ id: "gradle", label: "Gradle", snapshot: { status: "error", tasks: [], error: "gradlew exited 1" } }], entries: [], visibleEntries: [], query: "", selectedIndex: 0, error: "gradlew exited 1", unavailableReason: null,
  }, copy);
  assert.match(html, /gradlew exited 1/);
  assert.match(html, /data-tasks-action="refresh"/);
  assert.match(html, /Retry discovery/);
});

test("ready discovery reports the task count while retaining the filter and list", () => {
  const entry = { key: "p:one", providerId: "p", providerLabel: "P", task: { id: "one", label: "one", group: "Build", runnable: true } };
  const html = renderTasksView({ identity: { root: "/project", generation: 1 }, status: "ready", providers: [{ id: "p", label: "P", snapshot: { status: "ready", tasks: [entry.task] } }], entries: [entry], visibleEntries: [entry], query: "", selectedIndex: 0, error: null, unavailableReason: null }, copy);
  assert.match(html, /1 discovered/);
  assert.match(html, /data-tasks-query/);
  assert.match(html, /role="option"/);
});

test("terminal tasks expose localized status, retry, and output actions", () => {
  const terminalCopy = { ...copy, retry: "Retry", revealOutput: "Reveal", status: { failed: "Failed" } };
  const entry = { key: "p:failed", providerId: "p", providerLabel: "P", task: {
    id: "failed", label: "assembleDebug", group: "Build", runnable: true, runState: "failed",
  } };
  const html = renderTasksView({
    identity: { root: "/project", generation: 1 }, status: "ready", providers: [],
    entries: [entry], visibleEntries: [entry], query: "", selectedIndex: 0, error: null, unavailableReason: null,
  }, terminalCopy);
  assert.match(html, /role="status">Failed/);
  assert.match(html, /data-task-action="retry"/);
  assert.match(html, /data-task-action="reveal-output"/);
});
