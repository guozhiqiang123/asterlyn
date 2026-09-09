import assert from "node:assert/strict";
import test from "node:test";
import {
  beginHistoryQuery,
  completeRefHistory,
  emptyRefHistory,
  failRefHistory,
  installSnapshotHistory,
} from "../src/workbench/ref-history.ts";
import { defaultHistoryQuery } from "../src/workbench/history-query.ts";

const commit = (oid) => ({
  oid,
  shortOid: oid.slice(0, 7),
  parents: [],
  authorName: "Asterlyn Test",
  authorEmail: "test@asterlyn.invalid",
  authoredAt: 1,
  decorations: [],
  subject: oid,
});

test("ref history accepts only its current request identity", () => {
  const all = installSnapshotHistory(emptyRefHistory(), "/one", [commit("head")]);
  const first = beginHistoryQuery(all, "/one", {
    ...defaultHistoryQuery(),
    refs: ["refs/heads/first"],
  });
  const second = beginHistoryQuery(first.state, "/one", {
    ...defaultHistoryQuery(),
    refs: ["refs/heads/second"],
  });

  assert.equal(
    completeRefHistory(second.state, first.request, [commit("stale")]),
    second.state,
  );
  const ready = completeRefHistory(second.state, second.request, [commit("second")]);
  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.commits.map(({ oid }) => oid), ["second"]);

  const repeatedFirst = beginHistoryQuery(ready, "/one", second.request.query);
  const repeatedSecond = beginHistoryQuery(
    repeatedFirst.state,
    "/one",
    second.request.query,
  );
  assert.equal(
    completeRefHistory(repeatedSecond.state, repeatedFirst.request, [commit("old")]),
    repeatedSecond.state,
  );
});

test("repository and mutation changes invalidate pending ref responses", () => {
  const pending = beginHistoryQuery(emptyRefHistory(), "/one", {
    ...defaultHistoryQuery(),
    refs: ["refs/remotes/origin/main"],
  });
  const nextAll = installSnapshotHistory(pending.state, "/two", [commit("new-head")]);

  assert.equal(
    failRefHistory(nextAll, pending.request, "stale failure"),
    nextAll,
  );
  assert.equal(
    completeRefHistory(nextAll, pending.request, [commit("stale success")]),
    nextAll,
  );
  assert.equal(nextAll.source?.kind, "snapshot");
  assert.deepEqual(nextAll.commits.map(({ oid }) => oid), ["new-head"]);
});
