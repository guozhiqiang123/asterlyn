import assert from "node:assert/strict";
import test from "node:test";

import { WindowSession } from "../src/application/window-session.ts";

globalThis.window ??= globalThis;

test("tracked refresh updates only working state and follows with one untracked scan", async () => {
  const events = [];
  const session = new WindowSession({
    readProject(path) { return this.openProject(path); },
    readRepositorySlices(path) { return this.readProject(path); },
    async openProject(root) { return { root, repository: snapshot(root) }; },
    async readTrackedChanges(root) {
      return { root, changes: [change("src/a.ts", "modified")] };
    },
    async scanUntracked(root) {
      return { root, changes: [change("src/new.ts", "untracked")] };
    },
    async cancelUntrackedScan() {},
  });
  session.subscribe((event) => events.push(event));
  session.beginTransition();
  session.activate(
    { root: "/repo", repository: snapshot("/repo") },
    "activation",
    ["workspaceCatalog", "workingTree", "history"],
  );
  session.repository.consumeInvalidation();

  session.scheduleTrackedRefresh("/repo", "save", ["src/a.ts"], 0);
  await settle();
  await settle();

  assert.deepEqual(
    events.map((event) => event.reason),
    [
      "tracked-refresh-start",
      "tracked-refresh-complete",
      "untracked-scan-start",
      "untracked-scan-complete",
    ],
  );
  const tracked = events[1];
  assert.deepEqual(tracked.invalidation.slices, ["workingTree"]);
  assert.deepEqual(tracked.invalidation.paths, ["src/a.ts"]);
  assert.equal(session.repository.state.snapshot.commits[0].oid, "history");
  assert.deepEqual(
    session.repository.state.snapshot.changes.map((item) => item.path),
    ["src/a.ts", "src/new.ts"],
  );
});

test("a new transition cancels the active scan and rejects its late result", async () => {
  const pending = deferred();
  const cancelled = [];
  const events = [];
  const session = new WindowSession({
    readProject(path) { return this.openProject(path); },
    readRepositorySlices(path) { return this.readProject(path); },
    async openProject(root) { return { root, repository: snapshot(root) }; },
    async readTrackedChanges(root) { return { root, changes: [] }; },
    scanUntracked() { return pending.promise; },
    async cancelUntrackedScan(id) { cancelled.push(id); },
  });
  session.subscribe((event) => events.push(event));
  const generation = session.beginTransition();
  session.activate(
    { root: "/repo", repository: snapshot("/repo") },
    "activation",
    ["workingTree"],
  );
  session.repository.consumeInvalidation();
  const completion = session.scanUntracked("/repo", generation);
  session.beginTransition();
  pending.resolve({ root: "/repo", changes: [change("late.ts", "untracked")] });
  await completion;

  assert.equal(cancelled.length, 1);
  assert.deepEqual(events.map((event) => event.reason), ["untracked-scan-start"]);
  assert.deepEqual(session.repository.state.snapshot.changes, []);
});

test("project transitions activate only the latest window request", async () => {
  const first = deferred();
  const session = new WindowSession({
    readProject(path) { return this.openProject(path); },
    readRepositorySlices(path) { return this.readProject(path); },
    openProject(path) {
      return path === "/first" ? first.promise : Promise.resolve({
        root: path,
        repository: snapshot(path),
      });
    },
    async readTrackedChanges(root) { return { root, changes: [] }; },
    async scanUntracked(root) { return { root, changes: [] }; },
    async cancelUntrackedScan() {},
  });
  const stale = session.openProject("/first", "activation", ["workingTree"]);
  const current = await session.openProject("/second", "activation", ["workingTree"]);
  first.resolve({ root: "/first", repository: snapshot("/first") });

  assert.equal((await stale), null);
  assert.equal(current.project.root, "/second");
  assert.equal(session.workspace.state.root, "/second");
  let reconciliationReleased = false;
  const reconciliation = session.whenReconciliationIdle(
    session.workspace.identity(),
  ).then((released) => { reconciliationReleased = released; });
  await settle();
  assert.equal(reconciliationReleased, false);
  current.settle();
  await reconciliation;
  assert.equal(reconciliationReleased, true);
});

test("project refresh rejects a result after the window changes workspace", async () => {
  const pending = deferred();
  const session = new WindowSession({
    readProject(path) { return this.openProject(path); },
    readRepositorySlices(path) { return this.readProject(path); },
    openProject(path) {
      return path === "/first" ? pending.promise : Promise.resolve({
        root: path,
        repository: snapshot(path),
      });
    },
    async readTrackedChanges(root) { return { root, changes: [] }; },
    async scanUntracked(root) { return { root, changes: [] }; },
    async cancelUntrackedScan() {},
  });
  const generation = session.beginTransition();
  session.activate(
    { root: "/first", repository: snapshot("/first") },
    "activation",
    ["workingTree"],
  );
  const refresh = session.refreshProject(session.workspace.identity());

  const switched = await session.openProject("/second", "activation", ["workingTree"]);
  switched.settle();
  pending.resolve({ root: "/first", repository: snapshot("/first") });

  assert.equal(await refresh, null);
  assert.equal(session.workspace.state.root, "/second");
});

test("project refresh uses workspace identity after unrelated operation generations advance", async () => {
  let reads = 0;
  const session = new WindowSession({
    readProject(path) { return this.openProject(path); },
    readRepositorySlices(path) { return this.readProject(path); },
    async openProject(root) {
      reads += 1;
      return { root, repository: snapshot(root) };
    },
    async readTrackedChanges(root) { return { root, changes: [] }; },
    async scanUntracked(root) { return { root, changes: [] }; },
    async cancelUntrackedScan() {},
  });
  session.beginTransition();
  session.activate(
    { root: "/repo", repository: snapshot("/repo") },
    "activation",
    ["workingTree"],
  );
  const identity = session.workspace.identity();
  session.beginTransition();

  const refreshed = await session.refreshProject(identity);

  assert.equal(reads, 1);
  assert.equal(refreshed.root, "/repo");
});

test("repository slice refresh materializes only returned fields over the current revision", async () => {
  const session = new WindowSession({
    async openProject(root) { return { root, repository: snapshot(root) }; },
    async readProject(root) { return { root, repository: snapshot(root) }; },
    async readRepositorySlices(root, slices) {
      assert.deepEqual(slices, ["refs"]);
      return {
        root,
        repository: {
          root,
          gitDir: `${root}/.git`,
          repositoryRoots: [],
          branches: [{ fullName: "refs/heads/topic", oid: "b".repeat(40) }],
          remotes: [],
        },
      };
    },
    async readTrackedChanges(root) { return { root, changes: [] }; },
    async scanUntracked(root) { return { root, changes: [] }; },
    async cancelUntrackedScan() {},
  });
  session.beginTransition();
  const initial = snapshot("/repo");
  initial.changes = [change("kept.ts", "modified")];
  session.activate({ root: "/repo", repository: initial }, "activation", ["workingTree"]);

  const refreshed = await session.refreshRepositorySlices(
    session.workspace.identity(),
    ["refs"],
  );

  assert.deepEqual(refreshed.repository.changes.map((item) => item.path), ["kept.ts"]);
  assert.equal(refreshed.repository.branches[0].fullName, "refs/heads/topic");
});

test("same-root Git capability transitions use one full fallback and update both sessions", async () => {
  let gitAvailable = true;
  let fullReads = 0;
  const session = new WindowSession({
    async openProject(root) { return { root, repository: null }; },
    async readProject(root) {
      fullReads += 1;
      return { root, repository: gitAvailable ? snapshot(root) : null };
    },
    async readRepositorySlices(root) {
      return {
        root,
        repository: gitAvailable
          ? { root, gitDir: `${root}/.git` }
          : null,
      };
    },
    async readTrackedChanges(root) { return { root, changes: [] }; },
    async scanUntracked(root) { return { root, changes: [] }; },
    async cancelUntrackedScan() {},
  });
  session.beginTransition();
  session.activate({ root: "/repo", repository: null }, "activation", ["repositoryCapability"]);
  const identity = session.workspace.identity();

  const appearedLease = session.beginRepositoryRead(identity, ["repositoryCapability"]);
  const appeared = await session.refreshRepositorySlices(identity, ["repositoryCapability"]);
  const appearedCommit = session.installRepositoryRead(appearedLease, appeared, "watcher");
  assert.equal(appearedCommit.capabilityChanged, true);
  assert.equal(session.workspace.state.gitAvailable, true);
  assert.ok(session.repository.state.snapshot);
  assert.equal(fullReads, 1);

  gitAvailable = false;
  const disappearedLease = session.beginRepositoryRead(identity, ["repositoryCapability"]);
  const disappeared = await session.refreshRepositorySlices(identity, ["repositoryCapability"]);
  const disappearedCommit = session.installRepositoryRead(
    disappearedLease,
    disappeared,
    "watcher",
  );
  assert.equal(disappearedCommit.capabilityChanged, true);
  assert.equal(session.workspace.state.gitAvailable, false);
  assert.equal(session.repository.state.snapshot, null);
  assert.equal(fullReads, 1);
});

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
    commits: [{ oid: "history" }],
    branches: [],
    remotes: [],
    untrackedState: "pending",
  };
}

function change(path, worktreeStatus) {
  return {
    path,
    originalPath: null,
    indexStatus: "unmodified",
    worktreeStatus,
    conflicted: false,
    submodule: false,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
