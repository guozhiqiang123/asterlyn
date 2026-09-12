import assert from "node:assert/strict";
import test from "node:test";
import * as invalidation from "../src/application/session-invalidation.ts";
import * as workspace from "../src/application/workspace-session.ts";
import * as repository from "../src/application/repository-session.ts";

test("session invalidations merge only within one exact workspace identity", () => {
  const first = invalidation.createSessionInvalidation(
    "/repo",
    3,
    ["workingTree", "openDocuments"],
    "save",
    { paths: ["src/a.ts", "src/a.ts", "/unsafe"] },
  );
  const merged = invalidation.mergeSessionInvalidations(
    first,
    invalidation.createSessionInvalidation(
      "/repo",
      3,
      ["workspaceCatalog", "workingTree"],
      "watcher",
      { paths: ["src/b.ts"], overflowed: true },
    ),
  );
  assert.deepEqual(merged.slices, ["workspaceCatalog", "openDocuments", "workingTree"]);
  assert.deepEqual(merged.paths, ["src/a.ts", "src/b.ts"]);
  assert.deepEqual(merged.causes, ["save", "watcher"]);
  assert.equal(merged.overflowed, true);

  const replaced = invalidation.mergeSessionInvalidations(
    merged,
    invalidation.createSessionInvalidation("/other", 4, ["refs"], "activation"),
  );
  assert.equal(replaced.root, "/other");
  assert.deepEqual(replaced.slices, ["refs"]);
});

test("workspace identity changes only when the canonical root changes", () => {
  const session = new workspace.WorkspaceSession();
  const first = session.activate({ root: "/repo", repository: snapshot("/repo") });
  const refresh = session.activate({ root: "/repo", repository: snapshot("/repo") });
  const switched = session.activate({ root: "/other", repository: null });
  assert.equal(first.rootChanged, true);
  assert.equal(refresh.rootChanged, false);
  assert.equal(refresh.identity.generation, first.identity.generation);
  assert.equal(switched.identity.generation, first.identity.generation + 1);
  assert.equal(session.state.gitAvailable, false);
});

test("repository session merges tracked and untracked slices without replacing history", () => {
  const session = new repository.RepositorySession();
  const identity = { root: "/repo", generation: 1 };
  const initial = snapshot("/repo");
  session.install(identity, initial, "activation", ["workingTree", "refs", "history"]);
  const tracked = session.mergeTracked(identity, {
    root: "/repo",
    changes: [change("src/a.ts", "modified")],
  }, "save", ["src/a.ts"]);
  assert.equal(tracked.snapshot.commits, initial.commits);
  assert.deepEqual(tracked.snapshot.changes.map((item) => item.path), ["src/a.ts"]);

  const complete = session.mergeUntracked(identity, {
    root: "/repo",
    changes: [change("src/new.ts", "untracked")],
  }, "watcher");
  assert.deepEqual(complete.snapshot.changes.map((item) => item.path), ["src/a.ts", "src/new.ts"]);
  assert.equal(complete.snapshot.untrackedState, "complete");
  assert.equal(session.mergeTracked({ root: "/other", generation: 2 }, {
    root: "/other",
    changes: [],
  }, "save"), null);
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
    commits: [{ oid: "a".repeat(40) }],
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
