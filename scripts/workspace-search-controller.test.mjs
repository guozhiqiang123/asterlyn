import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceSearchController } from "../src/features/files-editor/workspace-search-controller.ts";

test("workspace search controller owns controls, request identity, and accepted results", async () => {
  const operations = fakeOperations();
  const controller = new WorkspaceSearchController(operations);
  controller.updateControls({
    mode: "regex",
    includeText: "src/**, **/*.ts",
    excludeText: "dist/**",
    contextLines: 2,
  });

  const completion = controller.run(
    { root: "/repo", generation: 4 },
    "needle",
    String,
  );
  assert.equal(controller.state.search.status, "loading");
  assert.deepEqual(controller.state.search.request.options, {
    mode: "regex",
    newLine: false,
    caseSensitive: false,
    wholeWord: false,
    excludeIgnored: true,
    includeGlobs: ["src/**", "**/*.ts"],
    excludeGlobs: ["dist/**"],
    contextLines: 2,
  });
  assert.equal(controller.requestIsCurrent("needle"), true);

  operations.complete(report(operations.operationId));
  assert.equal(await completion, true);
  assert.equal(controller.state.search.status, "ready");
  assert.equal(controller.hasCurrentResults("needle"), true);
});

test("a multi-line query becomes a multi-line request and stays request-identical", async () => {
  const operations = fakeOperations();
  const controller = new WorkspaceSearchController(operations);
  const query = "first\nsecond";
  const completion = controller.run({ root: "/repo", generation: 4 }, query, String);
  assert.equal(controller.state.search.request.options.newLine, true);
  assert.equal(controller.requestIsCurrent(query), true);
  assert.equal(controller.requestIsCurrent("first"), false);
  operations.complete(report(operations.operationId));
  assert.equal(await completion, true);
});

test("control changes cancel and invalidate a pending request", async () => {
  const operations = fakeOperations();
  const controller = new WorkspaceSearchController(operations);
  const completion = controller.run({ root: "/repo", generation: 1 }, "old", String);
  controller.updateControls({
    ...controller.state.controls,
    contextLines: 1,
  });
  assert.equal(operations.cancellations, 1);
  assert.equal(controller.state.search.status, "idle");

  operations.complete(report(operations.operationId));
  assert.equal(await completion, false);
  assert.equal(controller.state.search.report, null);
});

test("only the active failure is materialized and disposal cancels native work", async () => {
  const operations = fakeOperations();
  const controller = new WorkspaceSearchController(operations);
  const completion = controller.run(
    { root: "/repo", generation: 2 },
    "needle",
    (error) => `localized: ${error.message}`,
  );
  operations.fail(new Error("unavailable"));
  assert.equal(await completion, true);
  assert.equal(controller.state.search.status, "error");
  assert.equal(controller.state.search.error, "localized: unavailable");

  void controller.run({ root: "/repo", generation: 2 }, "again", String);
  controller.dispose();
  assert.equal(operations.cancellations, 1);
});

function fakeOperations() {
  let settle = null;
  let sequence = 0;
  return {
    operationId: "",
    cancellations: 0,
    startSearch() {
      this.operationId = `search-${++sequence}`;
      return {
        operationId: this.operationId,
        completion: new Promise((resolve) => { settle = resolve; }),
      };
    },
    cancelSearch() { this.cancellations += 1; },
    complete(value) { settle({ status: "success", value }); },
    fail(error) { settle({ status: "failure", error }); },
  };
}

function report(requestId) {
  return {
    requestId,
    matches: [{ workspacePath: "src/a.ts" }],
    coverageReasons: [],
    catalogCandidates: 1,
    eligibleCandidates: 1,
    filesSearched: 1,
    bytesRead: 1,
    skippedCount: 0,
    skippedFiles: [],
  };
}
