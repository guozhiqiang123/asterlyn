import assert from "node:assert/strict";
import test from "node:test";

import {
  createUnversionedGroupMutationRuntime,
} from "../src/features/changes-commit/unversioned-group-mutations.ts";

const target = {
  workspaceRoot: "/repo", workspaceGeneration: 3, kind: "group",
  group: "unversioned", repositoryId: ".", repositoryRevision: 7,
  paths: ["new-a.txt", "new-b.txt"],
};

function harness(overrides = {}) {
  const events = [];
  const lease = { id: 1, workspaceRoot: "/repo", workspaceGeneration: 2, editor: {} };
  const port = {
    current: () => true,
    saveDirtyTabsBefore: async (label) => { events.push(["save", label]); return true; },
    beginTransition: () => { events.push(["begin"]); return 4; },
    matches: () => true,
    completeTransition: (generation) => events.push(["complete", generation]),
    setLoading: (loading, message) => events.push(["loading", loading, message]),
    stagePaths: async (root, paths) => {
      events.push(["stage", root, paths]);
      return { tracked: { root, changes: [] }, invalidatedSlices: ["workingTree"] };
    },
    trashPaths: async (root, paths) => {
      events.push(["trash", root, paths]);
      return { tracked: { root, changes: [] }, invalidatedSlices: ["workingTree"] };
    },
    install: (outcome) => { events.push(["install"]); return outcome.tracked.root; },
    captureEditor: () => events.push(["capture"]),
    prepareTrash: () => ({ status: "ready", lease }),
    applyTrash: () => { events.push(["apply-trash"]); return "applied"; },
    releaseTrash: () => events.push(["release-trash"]),
    loadProjectFiles: async () => events.push(["files"]),
    render: () => events.push(["render"]),
    status: (message, tone) => events.push(["status", message, tone]),
    refresh: async () => events.push(["refresh"]),
    scanUntracked: async () => events.push(["scan"]),
    copy: () => ({
      targetChanged: "changed", stageAction: "stage all", saveBeforeTrash: "save first",
      trashBlocked: "blocked", ready: "ready",
      staging: (count) => `staging ${count}`, staged: (count) => `staged ${count}`,
      trashing: (completed, total) => `trashing ${completed}/${total}`,
      trashed: (count) => `trashed ${count}`,
    }),
    ...overrides,
  };
  return { events, runtime: createUnversionedGroupMutationRuntime(port) };
}

test("unversioned group Stage saves, mutates, reconciles and scans the exact paths", async () => {
  const { events, runtime } = harness();
  await runtime.stage(target);
  assert.deepEqual(events.filter(([name]) => ["stage", "install", "scan"].includes(name)), [
    ["stage", "/repo", ["new-a.txt", "new-b.txt"]], ["install"], ["scan"],
  ]);
  assert.ok(events.some((event) => event[0] === "status" && event[1] === "staged 2"));
});

test("unversioned group Trash applies one editor lease after the native exact-set mutation", async () => {
  const { events, runtime } = harness();
  const progress = [];
  await runtime.trash(target, (completed) => progress.push(completed));
  assert.deepEqual(progress, [2]);
  assert.deepEqual(events.filter(([name]) => ["capture", "trash", "apply-trash", "files"].includes(name)), [
    ["capture"], ["trash", "/repo", ["new-a.txt", "new-b.txt"]], ["apply-trash"], ["files"],
  ]);
  assert.equal(events.some(([name]) => name === "release-trash"), false);
});

test("unversioned group Trash blocks dirty editor targets before entering a transition", async () => {
  const { events, runtime } = harness({
    prepareTrash: () => ({ status: "blocked", reason: "dirtyDelete" }),
  });
  await assert.rejects(runtime.trash(target, () => {}), /save first/);
  assert.equal(events.some(([name]) => name === "begin"), false);
});
