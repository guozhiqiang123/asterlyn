import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultHistoryQuery,
  filterHistoryText,
  historyAuthorChoices,
  historyDateSince,
  historyQueryKey,
  isSnapshotHistoryQuery,
} from "../src/workbench/history-query.ts";

const commits = [
  commit("a".repeat(40), "Fix Parser", "Ada", "ada@example.invalid"),
  commit("b".repeat(40), "docs: parser", "Grace", "grace@example.invalid"),
  commit("c".repeat(40), "Release", "Ada", "ada@example.invalid"),
];

test("history query identity normalizes unordered refs and authors", () => {
  const first = {
    ...defaultHistoryQuery(),
    refs: ["refs/heads/z", "refs/heads/a", "refs/heads/a"],
    authorEmails: [" grace@example.invalid ", "ada@example.invalid"],
  };
  const second = {
    ...defaultHistoryQuery(),
    refs: ["refs/heads/a", "refs/heads/z"],
    authorEmails: ["ada@example.invalid", "grace@example.invalid"],
  };
  assert.equal(historyQueryKey(first), historyQueryKey(second));
  assert.equal(isSnapshotHistoryQuery(defaultHistoryQuery()), true);
  assert.equal(isSnapshotHistoryQuery(first), false);
});

test("text filtering supports case and regular expression modes", () => {
  assert.deepEqual(
    filterHistoryText(commits, "fix parser", {
      caseSensitive: false,
      regularExpression: false,
    }).commits.map(({ subject }) => subject),
    ["Fix Parser"],
  );
  assert.equal(
    filterHistoryText(commits, "fix parser", {
      caseSensitive: true,
      regularExpression: false,
    }).commits.length,
    0,
  );
  assert.deepEqual(
    filterHistoryText(commits, "^(Fix|Release)", {
      caseSensitive: true,
      regularExpression: true,
    }).commits.map(({ subject }) => subject),
    ["Fix Parser", "Release"],
  );
});

test("invalid expressions retain loaded commits and report the error", () => {
  const result = filterHistoryText(commits, "[", {
    caseSensitive: false,
    regularExpression: true,
  });
  assert.equal(result.commits, commits);
  assert.match(result.error, /unterminated|invalid/i);
});

test("author choices aggregate exact emails and date presets are deterministic", () => {
  assert.deepEqual(historyAuthorChoices(commits), [
    { email: "ada@example.invalid", name: "Ada", count: 2 },
    { email: "grace@example.invalid", name: "Grace", count: 1 },
  ]);
  assert.equal(historyDateSince("day", 8 * 24 * 60 * 60 * 1000), 7 * 24 * 60 * 60);
  assert.equal(historyDateSince("week", 8 * 24 * 60 * 60 * 1000), 24 * 60 * 60);
  assert.equal(historyDateSince("all", 123), null);
});

function commit(oid, subject, authorName, authorEmail) {
  return {
    oid,
    shortOid: oid.slice(0, 7),
    parents: [],
    authorName,
    authorEmail,
    authoredAt: 1,
    decorations: [],
    subject,
  };
}
