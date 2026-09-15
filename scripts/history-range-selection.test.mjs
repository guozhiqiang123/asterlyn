import assert from "node:assert/strict";
import test from "node:test";

import {
  HISTORY_RANGE_LIMIT,
  HistoryRangeSelectionController,
} from "../src/features/git-history/history-range-selection.ts";
import { renderHistoryList } from "../src/features/git-history/history-list-view.ts";

test("ordinary and shift selection keep an ordered logical range", () => {
  const controller = new HistoryRangeSelectionController();
  const entries = ["new", "middle", "old"].map(entry);
  controller.reconcile("query-1", entries);
  controller.select(".:middle", false);
  const result = controller.select(".:old", true);
  assert.deepEqual(result.selection.commits.map((commit) => commit.oid), ["middle", "old"]);
  assert.equal(result.selection.anchorKey, ".:middle");
  assert.equal(result.selection.activeKey, ".:old");
  assert.equal(result.limitedBy, null);
});

test("collapsed rows and the 100-commit cap bound range extension", () => {
  const controller = new HistoryRangeSelectionController();
  controller.reconcile("query-1", [entry("a"), { kind: "barrier", id: "gap" }, entry("b")]);
  controller.select(".:a", false);
  const barrier = controller.select(".:b", true);
  assert.equal(barrier.limitedBy, "barrier");
  assert.deepEqual(barrier.selection.commits.map((commit) => commit.oid), ["a"]);

  const many = Array.from({ length: HISTORY_RANGE_LIMIT + 5 }, (_, index) => entry(`c${index}`));
  controller.reconcile("query-2", many);
  controller.select(".:c0", false);
  const limited = controller.select(".:c104", true);
  assert.equal(limited.limitedBy, "limit");
  assert.equal(limited.selection.commits.length, HISTORY_RANGE_LIMIT);
  assert.equal(limited.selection.activeKey, ".:c99");
});

test("pagination preserves exact ranges while a query scope change clears them", () => {
  const controller = new HistoryRangeSelectionController();
  const initial = [entry("a"), entry("b"), entry("c")];
  controller.reconcile("query-1", initial);
  controller.select(".:a", false);
  controller.select(".:b", true);
  assert.equal(controller.reconcile("query-1", [...initial, entry("d")]).commits.length, 2);
  assert.equal(controller.reconcile("query-2", initial), null);
});

test("virtual-list HTML projects every logical selected row and one active endpoint", () => {
  const commits = [commit("a"), commit("b"), commit("c")];
  const html = renderHistoryList({
    status: "ready", error: null, loadedCommits: commits, commits, textError: null,
    selectedCommit: ".:c", selectedCommitKeys: [".:b", ".:c"], collapseLinear: false,
    bridgeOmittedParents: false,
    repositoryRoots: [{ id: ".", relativePath: ".", displayName: "root", kind: "main" }],
    branches: [], loadingMore: false, pagingError: null, hasMore: false,
  });
  assert.equal(html.match(/history-row selected/g)?.length, 2);
  assert.equal(html.match(/history-row selected active/g)?.length, 1);
  assert.match(html, /aria-multiselectable="true"/);
});

function entry(oid) {
  return { kind: "commit", key: `.:${oid}`, commit: commit(oid) };
}

function commit(oid) {
  return {
    repositoryId: ".", oid, shortOid: oid, parents: [], decorations: [],
    authorName: "A", authorEmail: "a@example.test", authoredAt: 1, subject: oid,
  };
}
