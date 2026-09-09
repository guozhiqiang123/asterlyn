import assert from "node:assert/strict";
import test from "node:test";

import {
  appendHistoryPage,
  matchesHistoryPageRequest,
  replaceHistoryPage,
} from "../src/workbench/history-paging.ts";

test("append paging deduplicates root-qualified commits and advances server offset", () => {
  const current = [commit(".", "a"), commit(".", "b")];
  const result = appendHistoryPage(
    current,
    {
      commits: [commit(".", "b"), commit("module", "b"), commit(".", "c")],
      offset: 2,
      hasMore: true,
    },
    10,
  );
  assert.deepEqual(
    result.commits.map(({ repositoryId, oid }) => `${repositoryId}:${oid}`),
    [".:a", ".:b", "module:b", ".:c"],
  );
  assert.equal(result.nextOffset, 5);
  assert.equal(result.hasMore, true);
});

test("page responses require sequence, generation, root, and query identity", () => {
  const current = {
    sequence: 4,
    generation: 8,
    root: "/workspace/main",
    queryKey: "normalized-query",
  };
  assert.equal(matchesHistoryPageRequest(current, current), true);
  for (const stale of [
    { ...current, sequence: 3 },
    { ...current, generation: 7 },
    { ...current, root: "/workspace/other" },
    { ...current, queryKey: "other-query" },
  ]) {
    assert.equal(matchesHistoryPageRequest(stale, current), false);
  }
});

test("top reconciliation replaces the window and enforces the row ceiling", () => {
  const result = replaceHistoryPage(
    {
      commits: [
        commit(".", "new"),
        commit(".", "new"),
        commit(".", "old"),
        commit(".", "older"),
      ],
      offset: 0,
      hasMore: true,
    },
    2,
  );
  assert.deepEqual(result.commits.map(({ oid }) => oid), ["new", "old"]);
  assert.equal(result.nextOffset, 4);
  assert.equal(result.hasMore, false);
});

function commit(repositoryId, oid) {
  return {
    repositoryId,
    oid,
    shortOid: oid,
    parents: [],
    authorName: "Test",
    authorEmail: "test@example.invalid",
    authoredAt: 1,
    decorations: [],
    subject: oid,
  };
}
