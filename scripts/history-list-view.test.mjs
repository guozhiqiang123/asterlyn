import assert from "node:assert/strict";
import test from "node:test";

import {
  HISTORY_ROW_LIMIT,
  renderHistoryList,
} from "../src/features/git-history/history-list-view.ts";
import { commitKey } from "../src/workbench/history-identity.ts";

test("history list projects selected commits, graph metadata, references, and roots", () => {
  const commits = [commit("tip", ["root"], ["HEAD -> main"]), commit("root", [], [])];
  const html = renderHistoryList({
    ...presentation(commits),
    selectedCommit: commitKey(commits[0]),
    repositoryRoots: [
      { id: ".", relativePath: ".", displayName: "root", kind: "main" },
      { id: "module", relativePath: "module", displayName: "module", kind: "submodule" },
    ],
    branches: [branch(".", "main")],
  });

  assert.match(html, /history-row selected/);
  assert.match(html, /aria-label="Graph lane 1 of 1, one parent"/);
  assert.match(html, /commit-reference head/);
  assert.match(html, /history-root-badge/);
  assert.match(html, /data-commit-key="\.:tip"/);
});

test("history list preserves paging and terminal status semantics", () => {
  const commits = [commit("only", [], [])];
  assert.match(
    renderHistoryList({ ...presentation(commits), hasMore: true }),
    /Scroll to load older commits/,
  );
  assert.match(
    renderHistoryList({ ...presentation(commits), pagingError: "network < unavailable" }),
    /network &lt; unavailable/,
  );
  assert.match(
    renderHistoryList({
      ...presentation(Array.from({ length: HISTORY_ROW_LIMIT }, (_, index) => commit(`c${index}`, [], []))),
      commits: [commits[0]],
    }),
    /session limit/,
  );
});

test("history list distinguishes query loading, backend failure, and text mismatch", () => {
  assert.match(
    renderHistoryList({ ...presentation([]), status: "loading" }),
    /Loading filtered history/,
  );
  assert.match(
    renderHistoryList({ ...presentation([]), status: "error", error: "bad < query" }),
    /bad &lt; query/,
  );
  const loaded = [commit("visible", [], [])];
  assert.match(
    renderHistoryList({ ...presentation(loaded), commits: [], textError: "[" }),
    /No matching commits/,
  );
});

function presentation(commits) {
  return {
    status: "ready",
    error: null,
    loadedCommits: commits,
    commits,
    textError: null,
    selectedCommit: null,
    collapseLinear: false,
    bridgeOmittedParents: false,
    repositoryRoots: [{ id: ".", relativePath: ".", displayName: "root", kind: "main" }],
    branches: [],
    loadingMore: false,
    pagingError: null,
    hasMore: false,
  };
}

function commit(oid, parents, decorations) {
  return {
    repositoryId: ".",
    oid,
    shortOid: oid,
    parents,
    authorName: "Asterlyn Test",
    authorEmail: "test@asterlyn.invalid",
    authoredAt: 1_700_000_000,
    decorations,
    subject: `Commit ${oid}`,
  };
}

function branch(repositoryId, name) {
  return {
    repositoryId,
    fullName: `refs/heads/${name}`,
    name,
    oid: "tip",
    current: true,
    kind: "local",
    upstream: null,
    tracking: null,
    committedAt: 1_700_000_000,
    subject: "Tip",
  };
}
