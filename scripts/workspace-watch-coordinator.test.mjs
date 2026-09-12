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
    {
      async reconcileExternalPaths(paths) { reads.documents.push([...paths]); },
    },
    {
      reconcileRepository(snapshot, slices, cause) {
        outcomes.push({ snapshot, slices, cause });
      },
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
    { async reconcileExternalPaths() {} },
    {
      reconcileRepository(snapshot, slices, cause) {
        outcomes.push({ snapshot, slices, cause });
      },
      reportWarning() {},
    },
    null,
  );
  coordinator.activate();
  await settle();

  watch.emit(event(session, ["workspaceCatalog", "refs", "history"], ["new.ts"]));
  await settle();
  assert.equal(catalogReads, 1);
  assert.equal(projectReads, 1);
  assert.equal(watch.starts, 2);
  assert.deepEqual(outcomes[0].slices, ["workspaceCatalog", "refs", "history"]);
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
    { async reconcileExternalPaths() {} },
    {
      reconcileRepository(snapshot) { outcomes.push(snapshot); },
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
    { async reconcileExternalPaths() {} },
    { reconcileRepository() {}, reportWarning() {} },
    null,
  );

  coordinator.activate();
  await settle();
  coordinator.dispose();
  activation.resolve({ available: true, message: null });
  await settle();

  assert.equal(stops, 2);
});

function activeSession(overrides = {}) {
  const session = new WindowSession({
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

function fakeWatchBridge() {
  let listener = null;
  return {
    native: true,
    starts: 0,
    async start() { this.starts += 1; return { available: true, message: null }; },
    async stop() {},
    async subscribe(next) { listener = next; return () => { listener = null; }; },
    emit(event) { listener?.(event); },
  };
}

function event(session, slices, paths) {
  return {
    root: session.workspace.state.root,
    generation: session.workspace.state.generation,
    slices,
    paths,
    causes: ["watcher"],
    overflowed: false,
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
