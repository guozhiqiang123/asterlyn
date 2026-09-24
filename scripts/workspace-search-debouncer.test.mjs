import assert from "node:assert/strict";
import test from "node:test";
import {
  hasCurrentWorkspaceSearch,
  WorkspaceSearchDebouncer,
  WORKSPACE_SEARCH_DEBOUNCE_MS,
} from "../src/features/files-editor/workspace-search-debouncer.ts";
import {
  beginWorkspaceSearch,
  createWorkspaceSearchControls,
  createWorkspaceSearchState,
  retainedWorkspaceSearchQuery,
  workspaceSearchOptions,
} from "../src/features/files-editor/workspace-search.ts";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const snapshot = (overrides = {}) => ({
  workspaceMode: true,
  root: "/repo",
  generation: 1,
  query: "first",
  requestCurrent: false,
  status: "idle",
  ...overrides,
});

test("workspace search waits for the last query and cancels pending work", async () => {
  assert.equal(WORKSPACE_SEARCH_DEBOUNCE_MS, 250);
  const debouncer = new WorkspaceSearchDebouncer(5);
  let current = snapshot();
  const runs = [];
  debouncer.schedule(() => current, () => runs.push(current.query));
  current = snapshot({ query: "second" });
  debouncer.schedule(() => current, () => runs.push(current.query));
  await wait(30);
  assert.deepEqual(runs, ["second"]);
  debouncer.schedule(() => current, () => runs.push(current.query));
  debouncer.cancel();
  await wait(30);
  assert.deepEqual(runs, ["second"]);
});

test("workspace search ignores a changed project and current results", async () => {
  const debouncer = new WorkspaceSearchDebouncer(5);
  let current = snapshot();
  let runs = 0;
  debouncer.schedule(() => current, () => { runs += 1; });
  current = snapshot({ root: "/another-repo" });
  await wait(30);
  assert.equal(runs, 0);
  current = snapshot({ requestCurrent: true, status: "ready" });
  debouncer.schedule(() => current, () => { runs += 1; });
  await wait(30);
  assert.equal(runs, 0);
  current = snapshot({ requestCurrent: true, status: "error" });
  debouncer.schedule(() => current, () => { runs += 1; });
  await wait(30);
  assert.equal(runs, 1);
});

test("current loading work is not restarted and Text keeps a pending query", () => {
  const controls = createWorkspaceSearchControls();
  const { state } = beginWorkspaceSearch(
    createWorkspaceSearchState(), 1, "/repo", "request-1", "first",
    workspaceSearchOptions(controls, "first"),
  );
  assert.equal(hasCurrentWorkspaceSearch(state, "/repo", 1, true), true);
  assert.equal(hasCurrentWorkspaceSearch(state, "/repo", 2, true), false);
  assert.equal(hasCurrentWorkspaceSearch(state, "/repo", 1, false), false);
  assert.equal(retainedWorkspaceSearchQuery("workspace", "workspace", "pending", "old"), "pending");
  assert.equal(retainedWorkspaceSearchQuery("workspace", "files", "files query", "old"), "old");
  assert.equal(retainedWorkspaceSearchQuery("files", "workspace", "pending", "old"), "");
});
