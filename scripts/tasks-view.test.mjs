import assert from "node:assert/strict";
import test from "node:test";

import { buildTaskTree, taskTreeBranchKeys } from "../src/features/tasks/tasks-tree.ts";
import { renderTasksView } from "../src/features/tasks/tasks-view.ts";

const copy = {
  title: "Tasks", refresh: "Refresh", empty: "Empty", unavailable: "Unavailable", loading: "Loading", cancelDiscovery: "Cancel discovery", retryDiscovery: "Retry discovery", discovered: (count) => `${count} discovered`, providerLoading: (provider) => `Discovering ${provider}`, showing: (count, total) => `Showing ${count} of ${total}`, showMore: "Show more",
  expand: (label) => `Expand ${label}`, collapse: (label) => `Collapse ${label}`,
  unavailableReasons: {
    "discovery-not-supported": "Not supported",
    "evidence-incomplete": "Incomplete evidence",
    "workspace-untrusted": "Untrusted workspace",
  },
  error: "Error", noResults: "No results", queryPlaceholder: "Filter", run: "Run", retry: "Retry", revealOutput: "Reveal", notRunnable: "Disabled", androidQuickActions: "Quick actions", quickActionKinds: { assemble: "Assemble", bundle: "Bundle", install: "Install", uninstall: "Uninstall" }, quickActionModule: "Module", quickActionVariant: "Variant", cacheValidating: "Verifying configuration", cacheRestored: (count) => `${count} restored`, cacheStale: "Showing stale tasks", cacheStaleReasons: { "fingerprint-mismatch": "Configuration changed", "watcher-change": "Watcher changed", "overflow-recovery": "Overflow recovery", "cache-expired": "Cache expired", "cache-corrupt": "Cache corrupt", "fingerprint-unavailable": "Fingerprint unavailable" }, refreshStale: "Refresh", retainedTasks: (count) => `Previous ${count}`, status: { failed: "Failed" },
};

function expanded(entries, root = "/project") {
  return taskTreeBranchKeys(buildTaskTree(entries, root, copy.title));
}

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
  }, copy, 250, expanded([{ key: "p:1", providerId: "p", providerLabel: "P", task: {
    id: "1", label: "build <debug>", group: "Build & Test", description: "Run \"debug\"", runnable: true,
  } }]));
  assert.match(html, /role="region"/);
  assert.match(html, /role="tree"/);
  assert.match(html, /role="treeitem"/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /data-task-key="p:1"/);
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
    assert.doesNotMatch(html, /class="tasks-row"/);
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
  assert.doesNotMatch(html, /class="tasks-header"/);
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
  const html = renderTasksView({ identity: { root: "/project", generation: 1 }, status: "ready", providers: [{ id: "p", label: "P", snapshot: { status: "ready", tasks: [entry.task] } }], entries: [entry], visibleEntries: [entry], query: "", selectedIndex: 0, error: null, unavailableReason: null }, copy, 250, expanded([entry]));
  assert.match(html, /1 discovered/);
  assert.match(html, /data-tasks-query/);
  assert.match(html, /data-task-key="p:one"/);
  assert.doesNotMatch(html, /class="tasks-header"/);
});

test("large task sets render in bounded batches while retaining the full match count", () => {
  const entries = Array.from({ length: 600 }, (_, index) => ({ key: `p:${index}`, providerId: "p", providerLabel: "P", task: { id: `${index}`, label: `task${index}`, group: "Build", runnable: true } }));
  const html = renderTasksView({ identity: { root: "/project", generation: 1 }, status: "ready", providers: [], entries, visibleEntries: entries, query: "", selectedIndex: 0, error: null, unavailableReason: null }, copy, 250, expanded(entries));
  assert.equal((html.match(/class="tasks-row"/gu) ?? []).length, 250);
  assert.match(html, /Showing 250 of 600/);
  assert.match(html, /data-tasks-action="show-more"/);
});

test("terminal tasks expose localized status, retry, and output actions", () => {
  const terminalCopy = { ...copy, retry: "Retry", revealOutput: "Reveal", status: { failed: "Failed" } };
  const entry = { key: "p:failed", providerId: "p", providerLabel: "P", task: {
    id: "failed", label: "assembleDebug", group: "Build", runnable: true, runState: "failed",
  } };
  const html = renderTasksView({
    identity: { root: "/project", generation: 1 }, status: "ready", providers: [],
    entries: [entry], visibleEntries: [entry], query: "", selectedIndex: 0, error: null, unavailableReason: null,
  }, terminalCopy, 250, expanded([entry]));
  assert.match(html, /role="status">Failed/);
  assert.match(html, /data-task-action="retry"/);
  assert.match(html, /data-task-action="reveal-output"/);
});

test("cache validation and stale states retain the tree but never enable Run", () => {
  const entry = { key: "p:cached", providerId: "p", providerLabel: "P", task: { id: "cached", label: "cached", group: "Build", runnable: false } };
  const base = { identity: { root: "/project", generation: 1 }, status: "ready", providers: [{ id: "p", label: "P", snapshot: { status: "ready", tasks: [entry.task] } }], entries: [entry], visibleEntries: [entry], query: "", selectedIndex: 0, error: null, unavailableReason: null };
  const validating = renderTasksView({ ...base, providers: [{ ...base.providers[0], snapshot: { ...base.providers[0].snapshot, cache: { status: "validating" } } }] }, copy, 250, expanded([entry]));
  assert.match(validating, /Verifying configuration/u);
  assert.match(validating, /data-task-key="p:cached"/u);
  assert.match(validating, /data-task-action="run"[^>]*disabled/u);
  const stale = renderTasksView({ ...base, providers: [{ ...base.providers[0], snapshot: { ...base.providers[0].snapshot, cache: { status: "stale", staleReason: "fingerprint-mismatch" } } }] }, copy, 250, expanded([entry]));
  assert.match(stale, /Configuration changed/u);
  assert.match(stale, /data-tasks-action="refresh"/u);
  assert.match(stale, /data-task-key="p:cached"/u);
});

test("failed refresh explains that the previous task tree is retained", () => {
  const entry = { key: "p:cached", providerId: "p", providerLabel: "P", task: { id: "cached", label: "cached", group: "Build", runnable: false } };
  const html = renderTasksView({ identity: { root: "/project", generation: 1 }, status: "error", providers: [{ id: "p", label: "P", snapshot: { status: "error", tasks: [entry.task], error: "Gradle failed" } }], entries: [entry], visibleEntries: [entry], query: "", selectedIndex: 0, error: "Gradle failed", unavailableReason: null }, copy, 250, expanded([entry]));
  assert.match(html, /Gradle failed/u);
  assert.match(html, /Previous 1/u);
  assert.match(html, /data-task-key="p:cached"/u);
});
