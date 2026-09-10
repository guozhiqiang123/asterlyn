import test from "node:test";
import assert from "node:assert/strict";
import {
  beginReplacementApply,
  beginReplacementPreview,
  closeReplacementPreview,
  completeReplacementApply,
  completeReplacementPreview,
  createWorkspaceReplacementState,
  failReplacement,
  matchesReplacementRequest,
  selectAllReplacementFiles,
  toggleReplacementFile,
} from "../src/workbench/workspace-replacement.ts";

const options = {
  mode: "regex",
  includeGlobs: ["src/**"],
  excludeGlobs: ["dist/**"],
  contextLines: 1,
};

function start(state = createWorkspaceReplacementState()) {
  return beginReplacementPreview(
    state,
    3,
    "/repo",
    "replace-1",
    "needle",
    "$1",
    options,
  );
}

const preview = {
  planId: "replace-1",
  totalMatches: 3,
  skippedCount: 0,
  coverageReasons: [],
  files: [
    { repositoryId: ".", path: "src/a.ts", workspacePath: "src/a.ts", matchCount: 2, byteDelta: 1, beforePreview: "needle", afterPreview: "found" },
    { repositoryId: ".", path: "src/b.ts", workspacePath: "src/b.ts", matchCount: 1, byteDelta: 0, beforePreview: "needle", afterPreview: "found" },
  ],
};

test("preview completion selects every reviewed file and supports explicit file selection", () => {
  const started = start();
  let state = completeReplacementPreview(started.state, started.request, preview);
  assert.equal(state.status, "ready");
  assert.deepEqual([...state.selectedPaths], ["src/a.ts", "src/b.ts"]);
  state = toggleReplacementFile(state, "src/a.ts");
  assert.deepEqual([...state.selectedPaths], ["src/b.ts"]);
  state = selectAllReplacementFiles(state, false);
  assert.equal(beginReplacementApply(state), state);
  state = selectAllReplacementFiles(state, true);
  assert.equal(beginReplacementApply(state).status, "applying");
});

test("every replacement input participates in stale completion identity", () => {
  const started = start();
  const changed = start(started.state);
  assert.equal(matchesReplacementRequest(changed.state, started.request), false);
  assert.equal(completeReplacementPreview(changed.state, started.request, preview), changed.state);
  const failed = failReplacement(changed.state, started.request, "late");
  assert.equal(failed, changed.state);
});

test("applied completion publishes recovery and closing invalidates a plan", () => {
  const started = start();
  let state = completeReplacementPreview(started.state, started.request, preview);
  state = beginReplacementApply(state);
  state = completeReplacementApply(state, started.request, {
    recoveryId: "replace-1",
    status: "applied",
    message: null,
    files: [{ workspacePath: "src/a.ts", state: "replaced" }],
  });
  assert.equal(state.status, "idle");
  assert.equal(state.recoveries[0].recoveryId, "replace-1");

  const next = start(state);
  const closed = closeReplacementPreview(next.state);
  assert.equal(closed.status, "idle");
  assert.equal(matchesReplacementRequest(closed, next.request), false);
});
