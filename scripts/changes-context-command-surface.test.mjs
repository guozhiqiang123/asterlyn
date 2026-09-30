import test from "node:test";
import assert from "node:assert/strict";

import { ChangesContextSurfaceRuntime } from "../src/features/changes-commit/changes-context-runtime.ts";
import { EN_US } from "../src/localization/en-US.ts";

function change(overrides = {}) {
  return {
    path: "src/app.ts", originalPath: null, indexStatus: "unmodified",
    worktreeStatus: "modified", conflicted: false, submodule: false, ...overrides,
  };
}

function snapshot(changes) {
  return {
    root: "/repo", gitDir: "/repo/.git",
    repositoryRoots: [{ id: ".", relativePath: ".", displayName: "repo", kind: "main" }],
    branch: {
      head: "main", oid: "a".repeat(40), upstream: null, upstreamRemote: null,
      upstreamRef: null, ahead: 0, behind: 0, detached: false, unborn: false,
    },
    operation: null, changes, commits: [], branches: [], remotes: [], untrackedState: "complete",
  };
}

test("Changes command surface resolves fresh file and unversioned-group identities", async () => {
  const listeners = new Map();
  const root = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
  };
  const events = [];
  let selectedPath = "src/app.ts";
  const currentSnapshot = snapshot([
    change(),
    change({ path: "new.txt", worktreeStatus: "untracked" }),
  ]);
  const runtime = new ChangesContextSurfaceRuntime({
    root,
    host: { open() {}, close() {}, revalidate() {} },
    clipboard: { async writeText() { return { status: "copied" }; } },
    source: () => ({
      snapshot: currentSnapshot, workspaceGeneration: 4, repositoryId: ".",
      repositoryRevision: 7, selectedPath,
    }),
    actions: {
      current: () => true,
      select: (target) => { events.push(["select", target.path]); return true; },
      included: () => true,
      snapshot: () => currentSnapshot,
      policyOptions: (target) => ({
        sourceAvailable: true, conflictAvailable: target.change.conflicted,
        mutationBusy: false, trashAvailable: true, reasons: EN_US.changes.contextMenu,
      }),
      groupPolicy: () => ({ stage: { kind: "enabled" }, trash: { kind: "enabled" } }),
      setIncluded() {}, showDiff() {}, jumpToSource: (target) => events.push(["source", target.path]),
      resolveConflict() {}, restore() {}, trash: (target) => events.push(["trash", target.path]),
      stageAll: (target) => events.push(["stage-all", [...target.paths]]), trashAll() {},
      installHistoryQuery() {}, blocked: (reason) => events.push(["blocked", reason]),
      status() {}, error: (error) => events.push(["error", error]),
    },
    copy: () => EN_US.changes,
  });

  assert.deepEqual(runtime.commandAvailability("source"), { enabled: true });
  assert.equal(runtime.commandAvailability("trash").enabled, false);
  await runtime.executeCommand("source");
  selectedPath = "new.txt";
  assert.deepEqual(runtime.commandAvailability("trash"), { enabled: true });
  await runtime.executeCommand("trash");
  await runtime.executeCommand("stage-all");
  assert.deepEqual(events, [
    ["select", "src/app.ts"], ["source", "src/app.ts"],
    ["select", "new.txt"], ["trash", "new.txt"],
    ["stage-all", ["new.txt"]],
  ]);

  selectedPath = null;
  assert.equal(runtime.commandAvailability("source").reason, EN_US.changes.selectFile);
  runtime.dispose();
  assert.equal(listeners.size, 0);
});
