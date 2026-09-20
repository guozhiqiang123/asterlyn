import assert from "node:assert/strict";
import test from "node:test";

import { renderRepositoryProjectionSlices } from "../src/application/repository-projection-renderer.ts";
import { routeHistoryDetailsChange } from "../src/features/git-history/history-change-router.ts";

test("repository slice rendering touches each affected surface once", () => {
  const events = [];
  renderRepositoryProjectionSlices(snapshot(), [
    "repositoryCapability", "workingTree", "head", "refs", "openDocuments", "history",
  ], {
    changesVisible: true,
    branchDetailVisible: true,
    renderCapability: () => events.push("capability"),
    renderChanges: () => events.push("changes"),
    renderRefs: (_snapshot, detail) => events.push(detail ? "refs+detail" : "refs"),
    renderEditor: () => events.push("editor"),
    renderStatus: () => events.push("status"),
    renderTransient: () => events.push("transient"),
  });
  assert.deepEqual(events, [
    "capability", "changes", "refs+detail", "editor", "status", "transient",
  ]);
});

test("History status-only changes do not rebuild rows or clear selection", () => {
  const events = [];
  routeHistoryDetailsChange({ reason: "refresh-start", statusChanged: true }, historyPort(events));
  assert.deepEqual(events, ["status"]);

  const snapshotEvents = [];
  routeHistoryDetailsChange(
    { reason: "snapshot", selectionChanged: true, historyChanged: true },
    historyPort(snapshotEvents),
  );
  assert.deepEqual(snapshotEvents, ["clear-range", "clear-inspection", "rows", "detail", "load", "menu"]);
});

function historyPort(events) {
  return {
    selectedCommit: ".:a", selectedFile: "a.txt", historyMounted: true, detailMounted: true,
    clearRangeSelection: () => events.push("clear-range"),
    clearCommitInspection: () => events.push("clear-inspection"),
    updateFileSelection: () => events.push("file"),
    renderHistoryRows: () => events.push("rows"),
    renderHistoryStatus: () => events.push("status"),
    updateCommitSelection: () => events.push("selection"),
    renderDetail: () => events.push("detail"),
    loadVisibleDetails: () => events.push("load"),
    revalidateContextMenu: () => events.push("menu"),
    warning: () => events.push("warning"), error: () => events.push("error"),
  };
}

function snapshot() {
  return {
    root: "/repo", gitDir: "/repo/.git", repositoryRoots: [],
    branch: {}, operation: null, changes: [], commits: [], branches: [], remotes: [],
    untrackedState: "complete",
  };
}
