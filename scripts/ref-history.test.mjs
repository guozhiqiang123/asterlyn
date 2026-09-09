import assert from "node:assert/strict";
import test from "node:test";
import {
  beginRefHistory,
  completeRefHistory,
  emptyRefHistory,
  failRefHistory,
  installHeadHistory,
} from "../src/workbench/ref-history.ts";

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
  const head = installHeadHistory(emptyRefHistory(), "/one", [commit("head")]);
  const first = beginRefHistory(head, "/one", "refs/heads/first");
  const second = beginRefHistory(first.state, "/one", "refs/heads/second");

  assert.equal(
    completeRefHistory(second.state, first.request, [commit("stale")]),
    second.state,
  );
  const ready = completeRefHistory(second.state, second.request, [commit("second")]);
  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.commits.map(({ oid }) => oid), ["second"]);

  const repeatedFirst = beginRefHistory(ready, "/one", "refs/heads/second");
  const repeatedSecond = beginRefHistory(
    repeatedFirst.state,
    "/one",
    "refs/heads/second",
  );
  assert.equal(
    completeRefHistory(repeatedSecond.state, repeatedFirst.request, [commit("old")]),
    repeatedSecond.state,
  );
});

test("repository and mutation changes invalidate pending ref responses", () => {
  const pending = beginRefHistory(
    emptyRefHistory(),
    "/one",
    "refs/remotes/origin/main",
  );
  const nextHead = installHeadHistory(pending.state, "/two", [commit("new-head")]);

  assert.equal(
    failRefHistory(nextHead, pending.request, "stale failure"),
    nextHead,
  );
  assert.equal(
    completeRefHistory(nextHead, pending.request, [commit("stale success")]),
    nextHead,
  );
  assert.equal(nextHead.source?.kind, "head");
  assert.deepEqual(nextHead.commits.map(({ oid }) => oid), ["new-head"]);
});
