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
  assert.deepEqual(fixture.records.documents, [true]);
  assert.deepEqual(fixture.records.remote, [changed]);
  assert.equal(fixture.records.refreshedHistory.length, 0);

  fixture.coordinator.applyMutation(
    { snapshot: changed, invalidatedSlices: ["head", "refs", "history"] },
    "gitMutation",
  );

  assert.equal(fixture.records.remote.length, 2);
  assert.deepEqual(fixture.records.refreshedHistory, [
    { root: "/repo", preferTip: true },
  ]);
  assert.equal(fixture.records.changes.length, 1);
  fixture.dispose();
});

test("workspace mutation reconciliation commits exact paths and projections", () => {
  const fixture = integrationFixture();
  const changed = snapshot("/repo", [{ path: "src/renamed.ts", conflicted: false }]);
  const outcome = {
    planId: "workspace-mutation-1",
    status: "completed",
    affectedPaths: ["src/old.ts", "src/renamed.ts"],
    pathRemaps: [{ source: "src/old.ts", destination: "src/renamed.ts" }],
    invalidatedSlices: ["workspaceCatalog", "openDocuments", "workingTree"],
    recoveryId: null,
    error: null,
  };

  fixture.coordinator.acceptWorkspaceMutation(changed, outcome);

  assert.deepEqual(fixture.session.repository.state.snapshot, changed);
  assert.deepEqual(fixture.records.changes, [{ snapshot: changed, options: {} }]);
  assert.deepEqual(fixture.records.files, [["src/renamed.ts"]]);
  assert.deepEqual(fixture.records.documents, [true]);
  assert.equal(fixture.records.remote.length, 0);
  assert.equal(fixture.records.refreshedHistory.length, 0);
  assert.equal(fixture.records.renders, 1);
  fixture.dispose();
});

test("metadata-only reconciliation preserves newer working state in canonical and projections", () => {
  const fixture = integrationFixture();
  const newerWorkingTree = snapshot("/repo", [{ path: "newer.ts", conflicted: false }]);
  fixture.coordinator.applyMutation(
    { snapshot: newerWorkingTree, invalidatedSlices: ["workingTree"] },
    "gitMutation",
  );
  const incoming = snapshot("/repo", [{ path: "older.ts", conflicted: false }]);
  incoming.branches = [{ fullName: "refs/heads/topic", oid: "b".repeat(40) }];

  const accepted = fixture.coordinator.reconcileWatchedRepository(
    { root: "/repo", repository: incoming },
    readLease(fixture, ["refs"]),
    "watcher",
  );

  assert.equal(accepted, true);
  assert.deepEqual(
    fixture.session.repository.state.snapshot.changes.map((item) => item.path),
    ["newer.ts"],
  );
  assert.deepEqual(
    fixture.records.remote.at(-1).changes.map((item) => item.path),
    ["newer.ts"],
  );
  assert.equal(fixture.records.changes.length, 1);
  assert.deepEqual(fixture.records.files, [["newer.ts"]]);
  fixture.dispose();
});

test("a watcher read lease cannot overwrite a later mutation commit", () => {
  const fixture = integrationFixture();
  const staleLease = readLease(fixture, ["head", "refs", "history"]);
  const newer = snapshot("/repo", [{ path: "newer.ts", conflicted: false }]);
  newer.branch = { ...newer.branch, head: "newer-operation" };
  fixture.coordinator.applyMutation(
    { snapshot: newer, invalidatedSlices: ["workingTree", "head", "refs", "history"] },
    "gitMutation",
  );
  const stale = snapshot("/repo", [{ path: "older.ts", conflicted: false }]);
  stale.branch = { ...stale.branch, head: "older-watch-read" };

  const accepted = fixture.coordinator.reconcileWatchedRepository(
    { root: "/repo", repository: stale },
    staleLease,
    "watcher",
  );

  assert.equal(accepted, false);
  assert.equal(fixture.session.repository.state.snapshot.branch.head, "newer-operation");
  assert.deepEqual(
    fixture.session.repository.state.snapshot.changes.map((item) => item.path),
    ["newer.ts"],
  );
  assert.equal(fixture.records.remote.at(-1).branch.head, "newer-operation");
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
  assert.match(fixture.records.dialogErrors[0], /Resolve the listed files/);
  assert.deepEqual(fixture.records.operations, [conflicted]);
  assert.equal(fixture.records.renders, 1);
  fixture.dispose();
});

test("conflict resolution reconciles working state without reading history or refs", () => {
  const fixture = integrationFixture();
  const operation = {
    kind: "merge",
    phase: "paused",
    originalHeadOid: "a".repeat(40),
    currentHeadOid: "a".repeat(40),
    headRef: "refs/heads/main",
    targetOids: ["b".repeat(40)],
    conflicts: [],
    progress: { current: null, total: null, detail: null },
    allowedActions: ["continue", "abort"],
  };

  const accepted = fixture.coordinator.applyGitOperationMutation({
    tracked: { root: "/repo", changes: [change("src/resolved.ts")] },
    operation,
    invalidatedSlices: ["openDocuments", "workingTree", "operation"],
  });

  assert.equal(accepted.operation, operation);
  assert.deepEqual(fixture.records.files, [["src/resolved.ts"]]);
  assert.deepEqual(fixture.records.operations, [accepted]);
  assert.deepEqual(fixture.records.documents, [true]);
  assert.deepEqual(fixture.records.remote, [accepted]);
  assert.equal(fixture.records.refreshedHistory.length, 0);
  fixture.dispose();
});

test("watch reconciliation removes unavailable Git projections without changing workspace", () => {
  const fixture = integrationFixture();

  fixture.coordinator.reconcileWatchedRepository(
    { root: "/repo", repository: null },
    readLease(fixture, ["workingTree", "refs", "history", "operation"]),
    "watcher",
  );

  assert.equal(fixture.session.repository.state.snapshot, null);
  assert.deepEqual(fixture.records.remote, [null]);
  assert.deepEqual(fixture.records.changes, [{ snapshot: null, options: {} }]);
  assert.deepEqual(fixture.records.files, [[]]);
  assert.equal(fixture.records.historyClears, 1);
  assert.deepEqual(fixture.records.operations, [null]);
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
  assert.deepEqual(fixture.records.refreshedHistory, [
    { root: "/repo", preferTip: false },
  ]);
  assert.deepEqual(fixture.records.operations, [refreshed]);
  assert.deepEqual(fixture.records.documents, [true]);
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
  assert.deepEqual(fixture.records.operations, [null]);
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
  assert.equal(fixture.records.remote.at(-1).untrackedState, "complete");
  assert.deepEqual(fixture.records.documents, [false]);
  assert.deepEqual(fixture.records.status.at(-1), ["Ready", "success"]);

  fixture.coordinator.dispose();
  await fixture.session.scanUntracked("/repo", fixture.session.generation, true, "watcher");
  assert.equal(fixture.records.renders, 1);
  fixture.session.dispose();
});

test("watch reconciliation completes a pending untracked scan", async () => {
  const scans = [];
  const fixture = integrationFixture({
    async scanUntracked(root) {
      scans.push(root);
      return { root, changes: [{ ...change("new.txt"), worktreeStatus: "untracked" }] };
    },
  });
  const pending = { ...snapshot("/repo", [{ path: "tracked.txt", conflicted: false }]), untrackedState: "pending" };

  fixture.coordinator.reconcileWatchedRepository(
    { root: "/repo", repository: pending },
    readLease(fixture, ["workingTree", "head", "refs", "history", "operation"]),
    "focusRecovery",
  );
  await settle();

  assert.deepEqual(scans, ["/repo"]);
  assert.equal(fixture.session.repository.state.snapshot.untrackedState, "complete");
  assert.deepEqual(
    fixture.session.repository.state.snapshot.changes.map((item) => item.path),
    ["new.txt", "tracked.txt"],
  );
  assert.equal(fixture.records.remote.at(-1).untrackedState, "complete");
  assert.deepEqual(fixture.records.files.at(-1), ["new.txt", "tracked.txt"]);
  assert.deepEqual(fixture.records.documents, [true, false]);
  fixture.dispose();
});

test("failed untracked scans replace the pending presentation", async () => {
  const fixture = integrationFixture({
    async scanUntracked() {
      throw new Error("scan unavailable");
    },
  });
  const pending = { ...snapshot("/repo", [{ path: "tracked.txt", conflicted: false }]), untrackedState: "pending" };

  fixture.coordinator.reconcileWatchedRepository(
    { root: "/repo", repository: pending },
    readLease(fixture, ["workingTree"]),
    "watcher",
  );
  await settle();

  assert.equal(fixture.session.repository.state.snapshot.untrackedState, "failed");
  assert.equal(fixture.records.remote.at(-1).untrackedState, "failed");
  assert.equal(fixture.records.changes.at(-1).snapshot.untrackedState, "failed");
  assert.match(String(fixture.records.errors.at(-1)), /scan unavailable/);
  fixture.dispose();
});

function integrationFixture(gatewayOverrides = {}) {
  const initial = snapshot("/repo");
  const session = new WindowSession({
    readProject(path) { return this.openProject(path); },
    readRepositorySlices(path) { return this.readProject(path); },
    async openProject(root) { return { root, repository: initial }; },
    async readTrackedChanges(root) { return { root, changes: [] }; },
    async scanUntracked(root) { return { root, changes: [] }; },
    async cancelUntrackedScan() {},
    ...gatewayOverrides,
  }, runtimeScheduler);
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
    operations: [],
    refreshedHistory: [],
    historyClears: 0,
    documents: [],
    hideHistory: 0,
    workspaceOnly: 0,
    renders: 0,
    details: 0,
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
      operations: { installSnapshot(value) { records.operations.push(value); } },
    },
    {
      reconcileRefreshedHistory(value, preferTip) {
        records.refreshedHistory.push({ root: value.root, preferTip });
      },
      reconcileWorkingDocument(_snapshot, reloadIfValid = true) {
        records.documents.push(reloadIfValid);
      },
      hideHistoryTool() { records.hideHistory += 1; },
      showWorkspaceOnlyTools() { records.workspaceOnly += 1; },
      renderWorkspace() { records.renders += 1; },
      loadVisibleCommitDetails() { records.details += 1; },
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

function readLease(fixture, slices) {
  return fixture.session.beginRepositoryRead(fixture.session.workspace.identity(), slices);
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

const runtimeScheduler = {
  schedule: (task, delayMs) => setTimeout(task, delayMs),
  cancel: (task) => clearTimeout(task),
};

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
