import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  delegatedContextKeyboardAnchor,
  isDelegatedContextKey,
} from "../src/shared/context-menu/delegated-context-binding.ts";
import { resolveProjectFilesContextTarget } from "../src/features/files-editor/project-files-binding.ts";
import { resolveChangesContextTarget } from "../src/features/changes-commit/changes-navigation-binding.ts";
import { resolveBranchContextTarget } from "../src/features/git-history/branch-context-binding.ts";
import { resolveHistoryCommitContextTarget } from "../src/features/git-history/history-context-binding.ts";
import { resolveCommitDetailContextTarget } from "../src/features/git-history/commit-detail-context-binding.ts";
import { buildProjectTree } from "../src/workbench/project-tree.ts";
import { branchKey, commitKey } from "../src/workbench/history-identity.ts";

const file = {
  repositoryId: ".",
  path: "src/app.ts",
  workspacePath: "src/app.ts",
  readOnly: false,
};
const change = {
  path: "src/app.ts",
  originalPath: null,
  indexStatus: "unmodified",
  worktreeStatus: "modified",
  conflicted: false,
  submodule: false,
};
const branch = {
  repositoryId: ".",
  kind: "local",
  fullName: "refs/heads/main",
  name: "main",
  current: true,
  upstream: null,
  tracking: null,
  oid: "a".repeat(40),
  subject: "main",
  committedAt: 1,
};
const commit = {
  repositoryId: ".",
  oid: "b".repeat(40),
  shortOid: "bbbbbbbb",
  parents: ["a".repeat(40)],
  authorName: "A",
  authorEmail: "a@example.test",
  authoredAt: 1,
  decorations: [],
  subject: "subject",
};

function repositorySnapshot() {
  return {
    root: "/workspace",
    gitDir: "/workspace/.git",
    repositoryRoots: [{ id: ".", relativePath: ".", displayName: "workspace" }],
    branch: { head: "main", oid: branch.oid, upstream: null, upstreamRemote: null, upstreamRef: null, ahead: 0, behind: 0, detached: false, unborn: false },
    operation: null,
    changes: [change],
    commits: [commit],
    branches: [branch],
    remotes: [],
    untrackedState: "complete",
  };
}

function historyState() {
  return {
    history: {
      root: "/workspace",
      source: null,
      commits: [commit],
      status: "ready",
      error: null,
      generation: 9,
    },
    query: {},
    selectedCommit: commitKey(commit),
    hasMore: false,
    nextOffset: 0,
    loadingMore: false,
    refreshing: false,
    pagingError: null,
    pagingRetry: null,
    details: {
      repositoryId: ".",
      oid: commit.oid,
      parentOid: commit.parents[0],
      files: [{ path: "src/app.ts", originalPath: null, status: "modified" }],
    },
    detailsLoading: false,
    detailsError: null,
    selectedFile: "src/app.ts",
  };
}

test("feature target resolvers reject stale display labels and retain exact identities", () => {
  const filesState = {
    root: "/workspace",
    paths: [file.workspacePath],
    files: [file],
    ignoredEntries: [],
    loading: false,
    error: null,
    truncated: false,
    selection: null,
    expandedDirectories: new Set(),
  };
  const tree = buildProjectTree([file.workspacePath]);
  assert.deepEqual(
    resolveProjectFilesContextTarget(filesState, tree, 4, "src/app.ts", "file"),
    {
      workspaceRoot: "/workspace", workspaceGeneration: 4, workspacePath: "src/app.ts",
      kind: "file", file, status: "unmodified", readOnly: false,
    },
  );
  assert.equal(resolveProjectFilesContextTarget(filesState, tree, 4, "app.ts", "file"), null);
  assert.equal(resolveProjectFilesContextTarget(filesState, tree, 4, "src", "file"), null);

  const snapshot = repositorySnapshot();
  const changesTarget = resolveChangesContextTarget(snapshot, 4, "src/app.ts", ".", 12);
  assert.equal(changesTarget?.change.path, "src/app.ts");
  assert.equal(changesTarget?.repositoryId, ".");
  assert.equal(changesTarget?.repositoryRevision, 12);
  assert.equal(resolveChangesContextTarget(snapshot, 4, "app.ts"), null);
  const branchTarget = resolveBranchContextTarget(
    snapshot, 4, 12, new Set(["."]), branchKey(branch),
  );
  assert.equal(branchTarget?.branch.fullName, branch.fullName);
  assert.equal(branchTarget?.repositoryRevision, 12);
  assert.equal(branchTarget?.matches.length, 1);
  assert.equal(resolveBranchContextTarget(
    snapshot, 4, 12, new Set(["."]), branch.name,
  ), null);
});

test("History and commit-detail targets bind object, query generation and exact path", () => {
  const state = historyState();
  const history = resolveHistoryCommitContextTarget(state, 5, 12, commitKey(commit));
  assert.equal(history?.oid, commit.oid);
  assert.equal(history?.historyGeneration, 9);
  assert.equal(history?.repositoryRevision, 12);
  assert.equal(resolveHistoryCommitContextTarget(state, 5, 12, commit.shortOid), null);

  const fileTarget = resolveCommitDetailContextTarget(state, 5, "file", "src/app.ts");
  assert.equal(fileTarget?.kind, "file");
  assert.equal(fileTarget?.file?.status, "modified");
  assert.equal(resolveCommitDetailContextTarget(state, 5, "directory", "src")?.path, "src");
  assert.equal(resolveCommitDetailContextTarget(state, 5, "directory", "missing"), null);
  assert.equal(resolveCommitDetailContextTarget({ ...state, selectedCommit: null }, 5, "file", "src/app.ts"), null);
});

test("delegated binding recognizes desktop keyboard invocation and derives a row anchor", () => {
  assert.equal(isDelegatedContextKey({ key: "ContextMenu", shiftKey: false }), true);
  assert.equal(isDelegatedContextKey({ key: "F10", shiftKey: true }), true);
  assert.equal(isDelegatedContextKey({ key: "F10", shiftKey: false }), false);
  assert.deepEqual(
    delegatedContextKeyboardAnchor({ left: 100, top: 50, width: 200, height: 28 }),
    { x: 116, y: 74 },
  );
});

test("all virtualized context surfaces own delegated bindings with stable row attributes", async () => {
  const [filesView, changesView, branchView, historyView, detailView, ...bindings] = await Promise.all([
    readFile(new URL("../src/features/files-editor/project-files-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/changes-commit/changes-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/git-history/branch-navigation-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/git-history/history-list-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/git-history/git-detail-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/project-files-binding.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/changes-commit/changes-navigation-binding.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/git-history/branch-context-binding.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/git-history/history-context-binding.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/git-history/commit-detail-context-binding.ts", import.meta.url), "utf8"),
  ]);
  assert.match(filesView, /data-project-kind/u);
  assert.match(changesView, /data-change-path/u);
  assert.match(branchView, /data-branch-key/u);
  assert.match(historyView, /data-commit-key/u);
  assert.match(detailView, /data-commit-file-directory/u);
  assert.match(detailView, /data-commit-file/u);
  for (const binding of bindings) {
    assert.match(binding, /new DelegatedContextBinding/u);
    assert.match(binding, /workspaceGeneration/u);
  }
});
