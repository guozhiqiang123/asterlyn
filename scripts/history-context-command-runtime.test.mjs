import test from "node:test";
import assert from "node:assert/strict";

import { GitHistoryContextRuntime } from "../src/features/git-history/git-history-context-runtime.ts";
import { branchKey, commitKey } from "../src/features/git-history/history-identity.ts";
import { EN_US } from "../src/localization/en-US.ts";

function commit(seed, subject) {
  return {
    repositoryId: ".", oid: seed.repeat(40), shortOid: seed.repeat(8), subject,
    authorName: "Dev", authorEmail: "dev@example.com", authoredAt: 1_700_000_000,
    parents: ["p".repeat(40)], decorations: [],
  };
}

test("History context commands resolve current range, file, and focused folder targets", async () => {
  const first = commit("a", "first");
  const second = commit("b", "second");
  const firstKey = commitKey(first);
  const secondKey = commitKey(second);
  const state = {
    history: {
      root: "/repo", status: "ready", error: null, commits: [first, second],
      source: { kind: "query" }, generation: 3,
    },
    query: {}, selectedCommit: secondKey, hasMore: true, nextOffset: 2,
    loadingMore: false, refreshing: false, pagingError: null, pagingRetry: null,
    details: {
      repositoryId: ".", oid: second.oid, parentOid: second.parents[0],
      files: [{ path: "src/app.ts", originalPath: null, status: "modified" }],
    },
    detailsLoading: false, detailsError: null, selectedFile: "src/app.ts",
  };
  const snapshot = {
    root: "/repo", gitDir: "/repo/.git",
    repositoryRoots: [{ id: ".", relativePath: ".", displayName: "repo", kind: "main" }],
    branch: {
      head: "main", oid: second.oid, upstream: null, upstreamRemote: null,
      upstreamRef: null, ahead: 0, behind: 0, detached: false, unborn: false,
    },
    operation: null, changes: [], commits: [first, second], branches: [], remotes: [],
    untrackedState: "complete",
  };
  const topic = {
    repositoryId: ".", kind: "local", fullName: "refs/heads/topic", name: "topic",
    current: false, upstream: null, tracking: null, oid: first.oid,
    subject: first.subject, committedAt: first.authoredAt,
  };
  snapshot.branches = [topic];
  const selection = {
    scopeKey: "scope", anchorKey: firstKey, activeKey: secondKey, commits: [first, second],
  };
  const listeners = [];
  const focusedDirectory = { parentElement: { dataset: { commitFileDirectory: "src" } } };
  const root = {
    addEventListener(type, listener) { listeners.push([type, listener]); },
    removeEventListener() {},
    querySelector(selector) {
      return selector === "[data-commit-file-directory] > summary:focus" ? focusedDirectory : null;
    },
  };
  const events = [];
  const feedback = {
    blocked: (reason) => events.push(["blocked", reason]), status() {},
    error: (error) => events.push(["error", error]),
  };
  const runtime = new GitHistoryContextRuntime({
    root,
    host: { open() {}, close() {}, revalidate() {} },
    clipboard: { async writeText() { return { status: "copied" }; } },
    copy: () => EN_US.history,
    sources: {
      branch: () => ({ snapshot, workspaceGeneration: 4, repositoryRevision: 5, selectedRepositoryIds: new Set(), selectedBranchKey: branchKey(topic) }),
      history: () => ({ state, workspaceGeneration: 4, repositoryRevision: 5, visible: true }),
      detail: () => ({ state, workspaceGeneration: 4, repositoryRevision: 5, snapshot, fileView: "tree" }),
      rangeSelection: () => selection,
      currentRangeSelection: () => selection,
      markHistoryTarget() {},
    },
    ports: {
      branch: {
        ...feedback, current: () => true, highlight() {}, snapshot: () => snapshot,
        policyOptions: () => ({ busy: false, clean: true, cleanReason: "", updateBlocked: null, pushBlocked: null }),
        showHistory: (target) => events.push(["ref-history", target.branch.name]),
        openMutation: (kind, branch) => events.push(["branch-mutation", kind, branch.name]),
        openGitOperation: (kind, ref) => events.push(["branch-operation", kind, ref]),
        openRemoteAction() {}, tagRemotes: () => [], openTagMutation() {},
      },
      commit: {},
      range: {
        ...feedback, current: () => true, policyOptions: () => ({}),
        openGitOperation() {}, openComparison: (target) => events.push(["compare", target.commits.length]),
      },
      file: {
        ...feedback, current: () => true,
        policy: () => ({ currentFile: { kind: "enabled" }, restore: { kind: "enabled" } }),
        highlight() {}, showDiff: (target) => events.push(["diff", target.path]),
        openHistorical: (target) => events.push(["historical", target.path]),
        compareCurrent: (target) => events.push(["compare-current", target.path]),
        openCurrent: (target) => events.push(["current", target.path]),
        restore: (target) => events.push(["restore", target.path]),
        installHistoryQuery: (intent) => events.push(["file-history", intent.query.paths[0].path]),
      },
      folder: {
        ...feedback, current: () => true, policy: () => ({ reveal: { kind: "enabled" } }),
        highlight() {}, showChanges: (target) => events.push(["folder-changes", target.path]),
        revealCurrentDirectory: (target) => events.push(["folder-reveal", target.path]),
        installHistoryQuery: (intent) => events.push(["folder-history", intent.query.paths[0].path]),
      },
    },
    manageRemotes() {},
    loadMoreHistory: () => events.push(["load-more"]),
    unavailableReason: () => "History required",
  });

  assert.deepEqual(runtime.commandAvailability("compare-selection"), { enabled: true });
  assert.deepEqual(runtime.commandAvailability("file-restore"), { enabled: true });
  assert.deepEqual(runtime.commandAvailability("folder-reveal"), { enabled: true });
  assert.deepEqual(runtime.commandAvailability("branch-merge"), { enabled: true });
  assert.equal(runtime.commandAvailability("tag-checkout").enabled, false);
  await runtime.executeCommand("compare-selection");
  await runtime.executeCommand("file-open-historical");
  await runtime.executeCommand("file-history");
  await runtime.executeCommand("folder-reveal");
  await runtime.executeCommand("folder-history");
  await runtime.executeCommand("load-more");
  await runtime.executeCommand("ref-history");
  await runtime.executeCommand("branch-merge");
  assert.deepEqual(events, [
    ["compare", 2], ["historical", "src/app.ts"], ["file-history", "src/app.ts"],
    ["folder-reveal", "src"], ["folder-history", "src"], ["load-more"],
    ["ref-history", "topic"], ["branch-operation", "merge", topic.fullName],
  ]);
  runtime.dispose();
  assert.equal(listeners.length > 0, true);
});
