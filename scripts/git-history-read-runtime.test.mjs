import assert from "node:assert/strict";
import test from "node:test";

import { GitHistoryReadRuntime } from "../src/features/git-history/git-history-read-runtime.ts";
import { defaultHistoryQuery } from "../src/history-query.ts";

test("Git History read runtime owns controller notifications and disposal", async () => {
  const notifications = [];
  let resolveHistory;
  const history = new Promise((resolve) => {
    resolveHistory = resolve;
  });
  const runtime = new GitHistoryReadRuntime(
    {
      details: {
        readHistoryPage: () => history,
        readCommitDetails: async () => {
          throw new Error("not expected");
        },
      },
      comparison: {
        readCommitComparisonDetails: async () => {
          throw new Error("not expected");
        },
      },
      historicalFile: {
        readCommitFile: async () => {
          throw new Error("not expected");
        },
      },
      historicalFileComparison: {
        compareCommitFileToCurrent: async () => {
          throw new Error("not expected");
        },
      },
    },
    {
      rowLimit: 20,
      messages: {
        olderCommitsFailed: (detail) => detail,
        historyRefreshFailed: (detail) => detail,
        historyRefreshWarning: "refresh failed",
        filteredHistoryWarning: "filter failed",
      },
    },
    {
      detailsChanged: (change) => notifications.push(change.reason),
      comparisonChanged: (change) => notifications.push(change.reason),
      historicalFileChanged: () => notifications.push("historical-file"),
      historicalFileComparisonChanged: () => notifications.push("historical-file-comparison"),
    },
  );

  runtime.details.loadQuery("/repo", defaultHistoryQuery());
  assert.deepEqual(notifications, ["query-start"]);

  runtime.dispose();
  runtime.dispose();
  resolveHistory({ commits: [], offset: 0, hasMore: false });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(notifications, ["query-start"]);
  assert.equal(runtime.comparison.swap(), false);
});
