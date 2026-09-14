import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceWatchCoordinator } from "../src/application/workspace-watch-coordinator.ts";
import { WindowSession } from "../src/application/window-session.ts";

globalThis.window ??= globalThis;

test("watch hints reconcile only their typed slices", async () => {
  const reads = { project: 0, tracked: 0, catalog: 0, documents: [] };
  const session = activeSession({
    async openProject(root) {
      reads.project += 1;
      return { root, repository: snapshot(root) };
    },
    async readTrackedChanges(root) {
      reads.tracked += 1;
      return { root, changes: [] };
    },
  });
  const watch = fakeWatchBridge();
  const outcomes = [];
  const coordinator = new WorkspaceWatchCoordinator(
    watch,
    session,
    { async refresh() { reads.catalog += 1; return true; } },
    editorFixture({
      async reconcileExternalPaths(paths) { reads.documents.push([...paths]); },
    }),
    {
      reconcileRepository(project, lease, cause) {
        outcomes.push({ snapshot: project.repository, slices: lease.slices, cause });
        return true;
      },
      refreshRemoteAfterFocus() {},
      reportWarning() {},
    },
    null,
  );
  coordinator.activate();
  await settle();

  watch.emit(event(session, ["openDocuments", "workingTree"], ["src/a.ts"]));
  await settle(10);
  await settle(10);

  assert.deepEqual(reads.documents, [["src/a.ts"]]);
  assert.equal(reads.tracked, 1);
  assert.equal(reads.catalog, 0);
  assert.equal(reads.project, 0);
  assert.deepEqual(outcomes, []);
  coordinator.dispose();
});

test("catalog and repository metadata are reconciled without accepting stale roots", async () => {
  let projectReads = 0;
  const session = activeSession({
    async openProject(root) {
      projectReads += 1;
      return { root, repository: snapshot(root) };
    },
  });
  const watch = fakeWatchBridge();
  let catalogReads = 0;
  const outcomes = [];
  const coordinator = new WorkspaceWatchCoordinator(
    watch,
    session,
    { async refresh() { catalogReads += 1; return true; } },
    editorFixture(),
    {
      reconcileRepository(project, lease, cause) {
        outcomes.push({ snapshot: project.repository, slices: lease.slices, cause });
        return true;
      },
      refreshRemoteAfterFocus() {},
      reportWarning() {},
    },
    null,
  );
  coordinator.activate();
  await settle();

  session.beginTransition();
  session.beginTransition();
  watch.emit(event(session, ["workspaceCatalog", "refs", "history"], ["new.ts"]));
  await settle();
  assert.equal(catalogReads, 1);
  assert.equal(projectReads, 1);
  assert.equal(watch.starts, 2);
  assert.deepEqual(outcomes[0].slices, ["refs", "history"]);
  assert.equal(outcomes[0].cause, "watcher");

  watch.emit({ ...event(session, ["refs"], []), root: "/stale" });
  await settle();
  assert.equal(projectReads, 1);
  coordinator.dispose();
});

test("repository reread failures are reported and a later hint can still reconcile", async () => {
  let fail = true;
  const session = activeSession({
    async openProject(root) {
      if (fail) throw new Error("metadata unavailable");
      return { root, repository: snapshot(root) };
    },
  });
  const watch = fakeWatchBridge();
  const warnings = [];
  const outcomes = [];
  const coordinator = new WorkspaceWatchCoordinator(
    watch,
    session,
    { async refresh() { return true; } },
    editorFixture(),
    {
      reconcileRepository(project) { outcomes.push(project.repository); return true; },
      refreshRemoteAfterFocus() {},
      reportWarning(message) { warnings.push(message); },
    },
    null,
  );
  coordinator.activate();
  await settle();

  watch.emit(event(session, ["refs"], []));
  await settle();
  assert.match(warnings[0], /metadata unavailable/);

  fail = false;
  watch.emit(event(session, ["refs"], []));
  await settle();
  assert.equal(outcomes.length, 1);
  coordinator.dispose();
});

test("watch reconciliation waits for an internal transition barrier", async () => {
  let projectReads = 0;
  const session = activeSession({
    async openProject(root) {
      projectReads += 1;
      return { root, repository: snapshot(root) };
    },
  });
  const watch = fakeWatchBridge();
  const coordinator = new WorkspaceWatchCoordinator(
    watch,
    session,
    { async refresh() { return true; } },
    editorFixture(),
    {
      reconcileRepository() { return true; },
      refreshRemoteAfterFocus() {},
      reportWarning() {},
    },
    null,
  );
  coordinator.activate();
  await settle();

  const generation = session.beginTransition({ reconciliationBarrier: true });
  watch.emit(event(session, ["refs"], []));
  await settle(10);
  assert.equal(projectReads, 0);

  session.completeTransition(generation);
  await settle(10);
  assert.equal(projectReads, 1);
  coordinator.dispose();
});

test("a disposed coordinator releases a watch that completes activation late", async () => {
  const activation = deferred();
  let stops = 0;
  const bridge = {
    native: true,
    start() { return activation.promise; },
    async stop() { stops += 1; },
    async subscribe() { return () => undefined; },
  };
  const session = activeSession();
  const coordinator = new WorkspaceWatchCoordinator(
    bridge,
    session,
    { async refresh() { return true; } },
    editorFixture(),
    { reconcileRepository() { return true; }, refreshRemoteAfterFocus() {}, reportWarning() {} },
    null,
  );

  coordinator.activate();
  await settle();
  coordinator.dispose();
  activation.resolve(watchStatus());
  await settle();

  assert.equal(stops, 2);
});

test("a superseding plan update keeps the installed watch until its replacement starts", async () => {
  const firstActivation = deferred();
  let starts = 0;
  let stops = 0;
  const bridge = {
    native: true,
    start() {
      starts += 1;
      return starts === 1 ? firstActivation.promise : Promise.resolve(watchStatus());
    },
    async stop() { stops += 1; },
    async subscribe() { return () => undefined; },
  };
  const session = activeSession();
  const coordinator = new WorkspaceWatchCoordinator(
    bridge,
    session,
    { async refresh() { return true; } },
    editorFixture(),
    { reconcileRepository() { return true; }, refreshRemoteAfterFocus() {}, reportWarning() {} },
    null,
  );

  coordinator.activate();
  await settle();
  coordinator.activate();
  firstActivation.resolve(watchStatus());
  await settle(10);

  assert.equal(starts, 2);
  assert.equal(stops, 0);
  coordinator.dispose();
});

test("returning from the background reconciles local state before one remote refresh", async () => {
  let now = 10_000;
  const reads = { project: 0, catalog: 0, documents: 0, remote: 0 };
  const session = activeSession({
    async openProject(root) {
      reads.project += 1;
      return { root, repository: snapshot(root) };
    },
  });
  const focusTarget = new EventTarget();
  const coordinator = new WorkspaceWatchCoordinator(
    fakeWatchBridge(),
    session,
    { async refresh() { reads.catalog += 1; return true; } },
    editorFixture({ async reconcileExternalPaths() { reads.documents += 1; } }),
    {
      reconcileRepository() { return true; },
      async refreshRemoteAfterFocus() {
        assert.equal(reads.project, 1);
        assert.equal(reads.catalog, 1);
        assert.equal(reads.documents, 1);
        reads.remote += 1;
      },
      reportWarning() {},
    },
    focusTarget,
    () => now,
  );
  coordinator.activate();
  await settle();

  focusTarget.dispatchEvent(new Event("blur"));
  now += 30_001;
  focusTarget.dispatchEvent(new Event("focus"));
  await settle(10);
  await settle(10);

  assert.equal(reads.remote, 1);
  focusTarget.dispatchEvent(new Event("blur"));
  now += 1;
  focusTarget.dispatchEvent(new Event("focus"));
  await settle(10);
  assert.equal(reads.project, 1);
  assert.equal(reads.catalog, 1);
  assert.equal(reads.documents, 1);
  assert.equal(reads.remote, 2);
  focusTarget.dispatchEvent(new Event("focus"));
  await settle();
  assert.equal(reads.remote, 2);
  coordinator.dispose();
});

test("old watcher instances are rejected and repeated backend overflow suspends automatic recovery", async () => {
  let projectReads = 0;
  const warnings = [];
  const session = activeSession({
    async openProject(root) {
      projectReads += 1;
      return { root, repository: snapshot(root) };
    },
  });
  const watch = fakeWatchBridge(watchStatus({ watchInstance: 5 }));
  const coordinator = new WorkspaceWatchCoordinator(
    watch,
    session,
    { async refresh() { return true; } },
    editorFixture(),
    {
      reconcileRepository() { return true; },
      refreshRemoteAfterFocus() {},
      reportWarning(message) { warnings.push(message); },
    },
    null,
  );
  coordinator.activate();
  await settle();

  watch.emit({ ...event(session, ["refs"], []), watchInstance: 4 });
  await settle();
  assert.equal(projectReads, 0);
  watch.emit({ ...event(session, ["refs"], []), watchInstance: 6 });
  await settle();
  assert.equal(projectReads, 1);

  const recovery = {
    ...event(session, [
      "workspaceCatalog",
      "openDocuments",
      "repositoryCapability",
      "workingTree",
      "head",
      "refs",
      "history",
      "operation",
    ], []),
    causes: ["overflowRecovery"],
    recovery: "backendOverflow",
    watchInstance: 6,
  };
  for (let index = 0; index < 4; index++) watch.emit(recovery);
  await settle(150);

  assert.equal(coordinator.health, "suspended");
  assert.ok(projectReads <= 4);
  assert.equal(warnings.length, 1);
  coordinator.dispose();
});

test("activation buffer overflow becomes one bounded complete verification", async () => {
  const activation = deferred();
  let listener = null;
  let projectReads = 0;
  const leases = [];
  const session = activeSession({
    async openProject(root) {
      projectReads += 1;
      return { root, repository: snapshot(root) };
    },
  });
  const bridge = {
    native: true,
    start() { return activation.promise; },
    async stop() {},
    async subscribe(next) { listener = next; return () => { listener = null; }; },
  };
  const coordinator = new WorkspaceWatchCoordinator(
    bridge,
    session,
    { async refresh() { return true; } },
    editorFixture(),
    {
      reconcileRepository(_project, lease) { leases.push([...lease.slices]); return true; },
      refreshRemoteAfterFocus() {},
      reportWarning() {},
    },
    null,
  );
  coordinator.activate();
  await settle();
  for (let index = 0; index < 65; index++) {
    listener?.(event(session, ["openDocuments"], [`src/${index}.ts`]));
  }
  activation.resolve(watchStatus());
  await settle(250);

  assert.equal(projectReads, 1);
  assert.deepEqual(leases, [[
    "repositoryCapability",
    "workingTree",
    "head",
    "refs",
    "history",
    "operation",
  ]]);
  assert.equal(coordinator.health, "healthy");
  coordinator.dispose();
});

test("stale repository reads have a retry budget and cannot self-loop", async () => {
  let projectReads = 0;
  const session = activeSession({
    async openProject(root) {
      projectReads += 1;
      return { root, repository: snapshot(root) };
    },
  });
  const watch = fakeWatchBridge();
  const coordinator = new WorkspaceWatchCoordinator(
    watch,
    session,
    { async refresh() { return true; } },
    editorFixture(),
    {
      reconcileRepository() { return false; },
      refreshRemoteAfterFocus() {},
      reportWarning() {},
    },
    null,
  );
  coordinator.activate();
  await settle();
  watch.emit(event(session, ["refs"], []));
  await settle(300);

  assert.equal(projectReads, 4);
  assert.equal(coordinator.health, "degraded");
  await settle(150);
  assert.equal(projectReads, 4);
  coordinator.dispose();
});

function activeSession(overrides = {}) {
  const session = new WindowSession({
    readProject(path) { return this.openProject(path); },
    async readRepositorySlices(root) {
      const project = await this.openProject(root);
      return { root: project.root, repository: project.repository };
    },
    async openProject(root) { return { root, repository: snapshot(root) }; },
    async readTrackedChanges(root) { return { root, changes: [] }; },
    async scanUntracked(root) { return { root, changes: [] }; },
    async cancelUntrackedScan() {},
    ...overrides,
  });
  session.beginTransition();
  session.activate(
    { root: "/repo", repository: snapshot("/repo") },
    "activation",
    ["workspaceCatalog", "workingTree", "history"],
  );
  session.repository.consumeInvalidation();
  return session;
}

function fakeWatchBridge(status = watchStatus()) {
  let listener = null;
  let currentStatus = status;
  return {
    native: true,
    starts: 0,
    async start() { this.starts += 1; return currentStatus; },
    async stop() {},
    async subscribe(next) { listener = next; return () => { listener = null; }; },
    emit(event) {
      if (
        currentStatus.watchInstance !== null &&
        event.watchInstance > currentStatus.watchInstance
      ) currentStatus = { ...currentStatus, watchInstance: event.watchInstance };
      listener?.(event);
    },
  };
}

function event(session, slices, paths) {
  return {
    root: session.workspace.state.root,
    generation: session.workspace.state.generation,
    watchInstance: 1,
    slices,
    paths,
    causes: ["watcher"],
    recovery: "none",
  };
}

function watchStatus(overrides = {}) {
  return {
    available: true,
    message: null,
    watchInstance: 1,
    verificationRequired: false,
    ...overrides,
  };
}

function editorFixture(overrides = {}) {
  return {
    subscribe() { return () => undefined; },
    workspacePaths() { return []; },
    async reconcileExternalPaths() {},
    ...overrides,
  };
}

function snapshot(root) {
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
    changes: [],
    commits: [],
    branches: [],
    remotes: [],
    untrackedState: "pending",
  };
}

function settle(delay = 0) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
