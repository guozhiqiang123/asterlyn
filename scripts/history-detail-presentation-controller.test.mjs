import assert from "node:assert/strict";
import test from "node:test";

import { HistoryDetailPresentationController } from "../src/features/git-history/history-detail-presentation-controller.ts";

test("history detail presentation owns mode, disclosure, and persisted file view", () => {
  const storage = memoryStorage({ "asterlyn.commitFileView.v1": "flat" });
  const controller = new HistoryDetailPresentationController(storage);
  assert.equal(controller.state.gitDetail, "commit");
  assert.equal(controller.state.commitFileView, "flat");

  controller.show("comparison");
  controller.setDirectoryExpanded("src", false);
  assert.equal(controller.state.gitDetail, "comparison");
  assert.deepEqual(Array.from(controller.state.collapsedCommitFileDirectories), ["src"]);

  controller.setDirectoryExpanded("src", true);
  controller.collapseDirectories([".", "src"]);
  assert.deepEqual(Array.from(controller.state.collapsedCommitFileDirectories), [".", "src"]);
  assert.equal(controller.toggleFileView(), "tree");
  assert.equal(storage.getItem("asterlyn.commitFileView.v1"), "tree");
});

test("commit and comparison patch generations reject stale completions", () => {
  const controller = new HistoryDetailPresentationController(memoryStorage());
  const firstCommit = controller.beginCommitPatch();
  const latestCommit = controller.beginCommitPatch();
  assert.equal(controller.completeCommitPatch(firstCommit, commitPatch("old")), false);
  assert.equal(controller.completeCommitPatch(latestCommit, commitPatch("new")), true);
  assert.equal(controller.state.commitPatch?.patch, "new");
  assert.equal(controller.state.commitPatchLoading, false);

  const comparison = controller.beginComparisonPatch();
  assert.equal(controller.failComparisonPatch(comparison, "failed"), true);
  assert.equal(controller.state.comparisonPatchError, "failed");
  controller.clearComparisonPatch();
  assert.equal(controller.completeComparisonPatch(comparison, comparisonPatch("late")), false);
  assert.equal(controller.state.comparisonPatch, null);
});

test("workspace reset clears transient detail state without losing the view preference", () => {
  const controller = new HistoryDetailPresentationController(memoryStorage());
  controller.show("folder");
  controller.toggleFileView();
  controller.collapseDirectories(["src"]);
  controller.beginCommitPatch();
  controller.beginComparisonPatch();
  controller.resetWorkspace();

  assert.equal(controller.state.gitDetail, "commit");
  assert.equal(controller.state.commitFileView, "flat");
  assert.deepEqual(Array.from(controller.state.collapsedCommitFileDirectories), []);
  assert.equal(controller.state.commitPatchLoading, false);
  assert.equal(controller.state.comparisonPatchLoading, false);
});

function commitPatch(patch) {
  return {
    repositoryId: ".",
    oid: "a".repeat(40),
    path: "src/app.ts",
    patch,
    truncated: false,
  };
}

function comparisonPatch(patch) {
  return {
    repositoryId: ".",
    beforeOid: "a".repeat(40),
    afterOid: "b".repeat(40),
    path: "src/app.ts",
    patch,
    truncated: false,
  };
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
}
