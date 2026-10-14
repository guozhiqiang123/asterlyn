import assert from "node:assert/strict";
import test from "node:test";

import { renderTasksView } from "../src/features/tasks/tasks-view.ts";

const copy = {
  title: "Tasks", refresh: "Refresh", empty: "Empty", unavailable: "Unavailable", loading: "Loading",
  unavailableReasons: {
    "discovery-not-supported": "Not supported",
    "evidence-incomplete": "Incomplete evidence",
    "workspace-untrusted": "Untrusted workspace",
  },
  error: "Error", noResults: "No results", queryPlaceholder: "Filter", run: "Run", notRunnable: "Disabled",
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
    assert.match(html, /role="status"/);
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
