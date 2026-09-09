import assert from "node:assert/strict";
import test from "node:test";

import {
  beginWorkspaceSearch,
  completeWorkspaceSearch,
  createWorkspaceSearchState,
  failWorkspaceSearch,
  formatWorkspaceSearchCoverage,
  invalidateWorkspaceSearch,
} from "../src/workbench/workspace-search.ts";

function report(requestId) {
  return {
    requestId,
    matches: [],
    catalogCandidates: 1,
    filesSearched: 1,
    bytesRead: 3,
    skippedCount: 0,
    skippedFiles: [],
    coverageReasons: [],
  };
}

test("workspace search accepts only the complete active identity", () => {
  const first = beginWorkspaceSearch(createWorkspaceSearchState(), 4, "/repo", "one", "abc");
  const second = beginWorkspaceSearch(first.state, 4, "/repo", "two", "abcd");
  assert.equal(
    completeWorkspaceSearch(second.state, first.request, report("one")),
    second.state,
  );
  assert.equal(
    completeWorkspaceSearch(second.state, second.request, report("wrong")),
    second.state,
  );
  const completed = completeWorkspaceSearch(second.state, second.request, report("two"));
  assert.equal(completed.status, "ready");
});

test("repository invalidation rejects late success and failure", () => {
  const started = beginWorkspaceSearch(createWorkspaceSearchState(), 7, "/repo", "one", "abc");
  const invalidated = invalidateWorkspaceSearch(started.state);
  assert.equal(
    completeWorkspaceSearch(invalidated, started.request, report("one")),
    invalidated,
  );
  assert.equal(failWorkspaceSearch(invalidated, started.request, "late"), invalidated);
});

test("coverage copy distinguishes complete results from every partial reason", () => {
  assert.equal(
    formatWorkspaceSearchCoverage(report("complete")),
    "0 matches · 1/1 files · 3 B · complete",
  );
  assert.equal(
    formatWorkspaceSearchCoverage({
      ...report("partial"),
      matches: [{}, {}],
      catalogCandidates: 5_000,
      filesSearched: 1_024,
      bytesRead: 64 * 1024 * 1024,
      skippedCount: 7,
      coverageReasons: [
        "catalogTruncated",
        "candidateLimit",
        "byteLimit",
        "matchLimit",
        "skippedFiles",
      ],
    }),
    "2 matches · 1024/5000 files · 64.0 MiB · partial: catalog limit, candidate limit, byte limit, match limit, 7 skipped",
  );
});
