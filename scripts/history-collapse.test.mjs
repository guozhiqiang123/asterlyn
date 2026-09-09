import assert from "node:assert/strict";
import test from "node:test";

import { collapseLinearHistory } from "../src/workbench/history-collapse.ts";
import { commitKey } from "../src/workbench/history-identity.ts";

test("linear history collapses interior commits and rewires only the graph projection", () => {
  const commits = linearCommits(6);
  const entries = collapseLinearHistory(commits, null);
  assert.equal(entries.length, 3);
  assert.equal(entries[1].kind, "collapsed");
  assert.equal(entries[1].count, 4);
  assert.deepEqual(entries[0].graphCommit.parents, [entries[1].graphCommit.oid]);
  assert.deepEqual(entries[1].graphCommit.parents, [commits[5].oid]);
  assert.deepEqual(commits[0].parents, [commits[1].oid]);
});

test("decorated, selected, merge, and branch-point commits remain structural rows", () => {
  const decorated = linearCommits(8);
  decorated[3].decorations = ["topic"];
  const decoratedEntries = collapseLinearHistory(decorated, null);
  assert.ok(decoratedEntries.some((entry) => entry.kind === "commit" && entry.commit.oid === decorated[3].oid));

  const selected = linearCommits(6);
  const selectedEntries = collapseLinearHistory(selected, commitKey(selected[2]));
  assert.ok(selectedEntries.some((entry) => entry.kind === "commit" && entry.commit.oid === selected[2].oid));

  const merge = linearCommits(6);
  merge[2].parents.push("side-parent");
  const mergeEntries = collapseLinearHistory(merge, null);
  assert.ok(mergeEntries.some((entry) => entry.kind === "commit" && entry.commit.oid === merge[2].oid));
});

test("a single eligible interior row is never replaced by a continuation", () => {
  const commits = linearCommits(3);
  assert.equal(collapseLinearHistory(commits, null).length, 3);
});

function linearCommits(count) {
  return Array.from({ length: count }, (_, index) => ({
    repositoryId: ".",
    oid: `oid-${index}`,
    shortOid: `oid-${index}`,
    parents: index + 1 < count ? [`oid-${index + 1}`] : [],
    authorName: "Asterlyn Test",
    authorEmail: "test@asterlyn.invalid",
    authoredAt: count - index,
    decorations: [],
    subject: `Commit ${index}`,
  }));
}
