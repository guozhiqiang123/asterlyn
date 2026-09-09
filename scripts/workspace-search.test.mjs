import assert from "node:assert/strict";
import test from "node:test";

import {
  beginWorkspaceSearch,
  completeWorkspaceSearch,
  createWorkspaceSearchControls,
  createWorkspaceSearchState,
  failWorkspaceSearch,
  formatWorkspaceSearchCoverage,
  invalidateWorkspaceSearch,
  parsePathGlobs,
  sameWorkspaceSearchOptions,
  workspaceSearchOptions,
} from "../src/workbench/workspace-search.ts";

const defaultOptions = workspaceSearchOptions(createWorkspaceSearchControls());

function report(requestId) {
  return {
    requestId,
    matches: [],
    catalogCandidates: 1,
    eligibleCandidates: 1,
    filesSearched: 1,
    bytesRead: 3,
    skippedCount: 0,
    skippedFiles: [],
    coverageReasons: [],
  };
}

test("workspace search accepts only the complete active identity", () => {
  const first = beginWorkspaceSearch(createWorkspaceSearchState(), 4, "/repo", "one", "abc", defaultOptions);
  const second = beginWorkspaceSearch(first.state, 4, "/repo", "two", "abcd", defaultOptions);
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
  const started = beginWorkspaceSearch(createWorkspaceSearchState(), 7, "/repo", "one", "abc", defaultOptions);
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
      eligibleCandidates: 2_000,
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
    "2 matches · 1024/2000 eligible · 5000 catalog · 64.0 MiB · partial: catalog limit, candidate limit, byte limit, match limit, 7 skipped",
  );
});

test("workspace search identity includes mode, ordered globs, and context", () => {
  const base = { ...defaultOptions, includeGlobs: ["src/**"] };
  const started = beginWorkspaceSearch(
    createWorkspaceSearchState(),
    2,
    "/repo",
    "search",
    "needle",
    base,
  );
  base.includeGlobs.push("mutated/**");
  assert.deepEqual(started.request.options.includeGlobs, ["src/**"]);
  assert.equal(
    completeWorkspaceSearch(
      started.state,
      { ...started.request, options: { ...started.request.options, mode: "regex" } },
      report("search"),
    ),
    started.state,
  );
  assert.equal(
    sameWorkspaceSearchOptions(
      started.request.options,
      { ...started.request.options, contextLines: 1 },
    ),
    false,
  );
});

test("comma-separated path controls preserve ordered non-empty full-path globs", () => {
  assert.deepEqual(parsePathGlobs(" src/**, , **/*.ts ,dist/file.js "), [
    "src/**",
    "**/*.ts",
    "dist/file.js",
  ]);
  assert.deepEqual(
    workspaceSearchOptions({
      mode: "regex",
      includeText: "src/**",
      excludeText: "src/generated/**",
      contextLines: 3,
    }),
    {
      mode: "regex",
      includeGlobs: ["src/**"],
      excludeGlobs: ["src/generated/**"],
      contextLines: 3,
    },
  );
});
