import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  HISTORY_MOUNT_LIMIT,
  HISTORY_ROW_LIMIT,
  historyRenderWindow,
  renderHistoryList,
} from "../src/features/git-history/history-list-view.ts";
import { commitKey } from "../src/features/git-history/history-identity.ts";

test("history list projects selected commits, graph metadata, references, and roots", () => {
  const commits = [
    { ...commit("tip", ["root"], ["HEAD -> main"]), outgoing: true },
    commit("root", [], []),
  ];
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
  assert.match(html, /aria-label="Graph lane 1 of 1, one parent,/);
  assert.match(html, /commit-reference head/);
  assert.match(html, /history-root-badge/);
  assert.match(html, /data-commit-key="\.:tip"/);
  assert.match(html, /commit-graph-node[^>]*outgoing/);
  assert.match(html, /not pushed to the current upstream/);
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
      ...presentation(commits),
      loadedCommits: new Array(HISTORY_ROW_LIMIT),
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

test("large history windows mount no more than the row budget", () => {
  const commits = Array.from(
    { length: 5_000 },
    (_, index) => commit(`c${index}`, [], []),
  );
  const window = historyRenderWindow(commits.length, 28 * 1_800, 840);
  const html = renderHistoryList(presentation(commits), window);
  const mounted = html.match(/data-commit-key=/g)?.length ?? 0;

  assert.ok(window.start > 0);
  assert.ok(window.end < commits.length);
  assert.ok(mounted <= HISTORY_MOUNT_LIMIT);
  assert.match(html, /history-list virtualized/);
  assert.match(html, /height:140006px/);
  assert.match(html, /history-virtual-window/);
});

test("a paginatable first page starts virtualized before it crosses the mount limit", () => {
  const commits = Array.from({ length: 150 }, (_, index) => commit(`c${index}`, [], []));
  const window = historyRenderWindow(commits.length, 28 * 100, 700, true);
  const html = renderHistoryList({ ...presentation(commits), hasMore: true }, window);

  assert.ok(window);
  assert.ok(window.end - window.start <= HISTORY_MOUNT_LIMIT);
  assert.match(html, /history-list virtualized/);
  assert.match(html, /height:4206px/);
});

test("virtual History updates preserve the native scrolling host", async () => {
  const source = await readFile(
    new URL("../src/features/git-history/history-list-view.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /currentList\.innerHTML = nextList\.innerHTML/u);
  assert.match(source, /currentList\.setAttribute\("style"[^\n]+\n\s*currentList\.className[^\n]+\n\s*currentList\.innerHTML/u);
  assert.match(source, /this\.projection = historyListProjection\(presentation\)/u);
  assert.match(source, /presentation\.hasMore \|\| this\.projection\.entries\.length > HISTORY_MOUNT_LIMIT/u);
  assert.match(source, /renderHistoryList\(this\.presentation, window, this\.projection\)/u);
  assert.doesNotMatch(source, /this\.host\.scrollTop\s*=\s*scrollTop/u);
  assert.doesNotMatch(source, /this\.host\.scrollLeft\s*=\s*scrollLeft/u);
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
