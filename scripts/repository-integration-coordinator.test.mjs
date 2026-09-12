import assert from "node:assert/strict";
import test from "node:test";

import {
  RepositoryIntegrationCoordinator,
} from "../src/application/repository-integration-coordinator.ts";
import { WindowSession } from "../src/application/window-session.ts";

globalThis.window ??= globalThis;

test("repository integration applies only declared projection slices", () => {
  const fixture = integrationFixture();
  const changed = snapshot("/repo", [{ path: "src/app.ts", conflicted: false }]);

  fixture.coordinator.applyMutation(
    { snapshot: changed, invalidatedSlices: ["workingTree"] },
    "gitMutation",
  );

  assert.equal(fixture.records.changes.length, 1);
  assert.deepEqual(fixture.records.files, [["src/app.ts"]]);
  assert.equal(fixture.records.documents, 1);
  assert.equal(fixture.records.remote.length, 0);
  assert.equal(fixture.records.history.length, 0);
  assert.equal(fixture.records.branchClears, 0);

  fixture.coordinator.applyMutation(
    { snapshot: changed, invalidatedSlices: ["head", "refs", "history"] },
    "gitMutation",
  );

  assert.equal(fixture.records.remote.length, 1);
  assert.equal(fixture.records.history.length, 1);
  assert.equal(fixture.records.branchClears, 1);
  assert.equal(fixture.records.changes.length, 1);
  fixture.dispose();
});

test("remote conflict routing selects the first conflict through one entry point", () => {
  const fixture = integrationFixture();
  const conflicted = snapshot("/repo", [
    { path: "src/first.ts", conflicted: true },
    { path: "src/second.ts", conflicted: true },
  ]);

  fixture.coordinator.acceptRemoteOutcome(
    {
      snapshot: conflicted,
      invalidatedSlices: ["workingTree", "operation"],
    },
    true,
  );

  assert.deepEqual(fixture.records.conflictSelections, ["src/first.ts"]);
  assert.deepEqual(fixture.records.openDiffs, [{ root: "/repo", path: "src/first.ts" }]);
  assert.equal(fixture.records.showChanges, 1);
  assert.match(fixture.records.dialogErrors[0], /read-only Diff/);
  assert.equal(fixture.records.renders, 1);
  fixture.dispose();
});

test("watch reconciliation removes unavailable Git projections without changing workspace", () => {
  const fixture = integrationFixture();

  fixture.coordinator.reconcileWatchedRepository(
    null,
    ["workingTree", "refs", "history", "operation"],
    "watcher",
  );

  assert.equal(fixture.session.repository.state.snapshot, null);
  assert.deepEqual(fixture.records.remote, [null]);
  assert.deepEqual(fixture.records.changes, [{ snapshot: null, options: {} }]);
  assert.deepEqual(fixture.records.files, [[]]);
  assert.equal(fixture.records.historyClears, 1);
  assert.equal(fixture.records.hideHistory, 1);
  assert.equal(fixture.records.renders, 1);
  fixture.dispose();
});

test("manual refresh reconciles one canonical snapshot without duplicating routing in the shell", () => {
  const fixture = integrationFixture();
  const refreshed = snapshot("/repo", [{ path: "src/refreshed.ts", conflicted: false }]);

  const accepted = fixture.coordinator.acceptManualRefresh(
    "/repo",
    refreshed,
    fixture.session.generation,
  );

  assert.equal(accepted, refreshed);
  assert.deepEqual(fixture.records.remote, [refreshed]);
  assert.deepEqual(fixture.records.workspaces, [
    { root: "/repo", changes: ["src/refreshed.ts"] },
  ]);
  assert.equal(fixture.records.refreshedHistory, 1);
  assert.equal(fixture.records.documents, 1);
  assert.equal(fixture.records.renders, 1);
  assert.deepEqual(fixture.records.loads, [
    { root: "/repo", generation: fixture.session.generation },
  ]);
  fixture.dispose();
});

test("manual refresh keeps an ordinary workspace and disables Git projections", () => {
  const fixture = integrationFixture();

  const accepted = fixture.coordinator.acceptManualRefresh(
    "/repo",
    null,
    fixture.session.generation,
  );

  assert.equal(accepted, null);
  assert.deepEqual(fixture.records.remote, [null]);
  assert.equal(fixture.records.historyClears, 1);
  assert.equal(fixture.records.workspaceOnly, 1);
  assert.deepEqual(fixture.records.loads, [
    { root: "/repo", generation: fixture.session.generation },
  ]);
  fixture.dispose();
});

test("manual refresh rejects stale generations before touching feature projections", () => {
  const fixture = integrationFixture();
  const accepted = fixture.coordinator.acceptManualRefresh(
    "/repo",
    snapshot("/repo"),
    fixture.session.generation + 1,
  );

  assert.equal(accepted, null);
  assert.equal(fixture.records.remote.length, 0);
  assert.equal(fixture.records.renders, 0);
  fixture.dispose();
});

test("session scans reuse the same integration route and stop after disposal", async () => {
  const fixture = integrationFixture({
    async scanUntracked(root) {
      return { root, changes: [{ ...change("new.txt"), worktreeStatus: "untracked" }] };
    },
  });

  await fixture.session.scanUntracked("/repo", fixture.session.generation, true, "watcher");
  assert.equal(fixture.records.renders, 1);
  assert.deepEqual(fixture.records.status.at(-1), ["Ready", "normal"]);

  fixture.coordinator.dispose();
  await fixture.session.scanUntracked("/repo", fixture.session.generation, true, "watcher");
  assert.equal(fixture.records.renders, 1);
  fixture.session.dispose();
});

function integrationFixture(gatewayOverrides = {}) {
  const initial = snapshot("/repo");
  const session = new WindowSession({
    async openProject(root) { return { root, repository: initial }; },
    async readTrackedChanges(root) { return { root, changes: [] }; },
    async scanUntracked(root) { return { root, changes: [] }; },
    async cancelUntrackedScan() {},
    ...gatewayOverrides,
  });
  session.beginTransition();
  session.activate(
    { root: "/repo", repository: initial },
    "activation",
    ["workspaceCatalog", "workingTree", "history"],
  );
  session.repository.consumeInvalidation();

  const records = {
    remote: [],
    dialogErrors: [],
    changes: [],
    conflictSelections: [],
    files: [],
    workspaces: [],
    history: [],
    refreshedHistory: 0,
    historyClears: 0,
    branchClears: 0,
    documents: 0,
    hideHistory: 0,
    workspaceOnly: 0,
    renders: 0,
    details: 0,
    reloads: 0,
    loads: [],
    showChanges: 0,
    openDiffs: [],
    status: [],
    errors: [],
  };
  const coordinator = new RepositoryIntegrationCoordinator(
    session,
    {
      remote: {
        installSnapshot(value) { records.remote.push(value); },
        setDialogError(value) { records.dialogErrors.push(value); },
      },
      changes: {
        installSnapshot(value, options = {}) {
          records.changes.push({ snapshot: value, options: { ...options } });
        },
        selectConflict(path) { records.conflictSelections.push(path); return true; },
      },
      files: {
        installWorkspace(root, changes = []) {
          records.workspaces.push({ root, changes: changes.map((item) => item.path) });
        },
        updateChanges(changes) { records.files.push(changes.map((item) => item.path)); },
      },
      history: { clear() { records.historyClears += 1; } },
    },
    {
      clearBranchSelection() { records.branchClears += 1; },
      installSnapshotHistory(value, preferTip) {
        records.history.push({ root: value.root, preferTip });
      },
      reconcileRefreshedHistory() { records.refreshedHistory += 1; },
      reconcileWorkingDocument() { records.documents += 1; },
      hideHistoryTool() { records.hideHistory += 1; },
      showWorkspaceOnlyTools() { records.workspaceOnly += 1; },
      renderWorkspace() { records.renders += 1; },
      loadVisibleCommitDetails() { records.details += 1; },
      reloadWorkingDiff() { records.reloads += 1; },
      loadProjectFiles(root, generation) { records.loads.push({ root, generation }); },
      showChangesTool() { records.showChanges += 1; },
      openWorkingDiff(root, path) { records.openDiffs.push({ root, path }); },
      replacementRecoveryCount() { return 0; },
      setStatus(message, kind) { records.status.push([message, kind]); },
      reportError(error) { records.errors.push(error); },
    },
  );
  return {
    session,
    coordinator,
    records,
    dispose() {
      coordinator.dispose();
      session.dispose();
    },
  };
}

function snapshot(root, changes = []) {
  return {
    root,
    gitDir: `${root}/.git`,
    repositoryRoots: [],
    branch: {
      head: "main",
      oid: "a".repeat(40),
      upstream: null,
      upstreamRemote: null,
      upstreamRef: null,
      ahead: 0,
      behind: 0,
      detached: false,
      unborn: false,
    },
    operation: null,
    changes: changes.map((item) => ({ ...change(item.path), ...item })),
    commits: [],
    branches: [],
    remotes: [],
    untrackedState: "complete",
  };
}

function change(path) {
  return {
    repositoryId: ".",
    path,
    originalPath: null,
    indexStatus: "unmodified",
    worktreeStatus: "modified",
    conflicted: false,
    submodule: false,
  };
}
