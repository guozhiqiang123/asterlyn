import assert from "node:assert/strict";
import test from "node:test";

import { projectConflictResultBlame } from "../src/features/files-editor/conflict-blame-projection.ts";

const hunk = (oid, line, author = oid) => ({
  oid,
  originalStartLine: line,
  finalStartLine: line,
  lineCount: 1,
  authorName: author,
  authorEmail: `${author}@example.com`,
  authoredAt: line,
  summary: `commit ${oid}`,
  uncommitted: false,
});

const source = (text, hunks, revision) => ({
  text,
  blame: { repositoryId: ".", path: "file.txt", revision, hunks, truncated: false },
});

test("conflict Result inherits unique and agreed source attribution", () => {
  const common = hunk("common", 1);
  const commonTail = hunk("tail", 3);
  const projected = projectConflictResultBlame("file.txt", "a\nours\ntheirs\nmanual\ncommon", [
    source("a\nours\ncommon", [common, hunk("ours", 2), commonTail], "ours-revision"),
    source("a\ntheirs\ncommon", [common, hunk("theirs", 2), commonTail], "theirs-revision"),
  ]);

  assert.deepEqual(projected.hunks.map((entry) => ({
    line: entry.finalStartLine,
    count: entry.lineCount,
    oid: entry.oid,
    local: entry.uncommitted,
  })), [
    { line: 1, count: 1, oid: "common", local: false },
    { line: 2, count: 1, oid: "ours", local: false },
    { line: 3, count: 1, oid: "theirs", local: false },
    { line: 4, count: 1, oid: "0000000000000000000000000000000000000000", local: true },
    { line: 5, count: 1, oid: "tail", local: false },
  ]);
});

test("conflict Result marks a line local when both sides disagree about its source", () => {
  const projected = projectConflictResultBlame("file.txt", "same", [
    source("same", [hunk("left", 1)], "left-revision"),
    source("same", [hunk("right", 1)], "right-revision"),
  ]);

  assert.equal(projected.hunks.length, 1);
  assert.equal(projected.hunks[0].uncommitted, true);
});

test("conflict Result compacts adjacent local lines", () => {
  const projected = projectConflictResultBlame("file.txt", "one\ntwo", []);

  assert.equal(projected.hunks.length, 1);
  assert.equal(projected.hunks[0].finalStartLine, 1);
  assert.equal(projected.hunks[0].lineCount, 2);
  assert.equal(projected.hunks[0].uncommitted, true);
});
