import assert from "node:assert/strict";
import test from "node:test";

import {
  hasGitConflictMarkers,
  initialConflictResult,
  threeWayMerge,
} from "../src/features/git-operations/conflict-merge.ts";

test("a marker-free worktree remains the exact initial conflict result", () => {
  const conflict = fixture({ worktree: "manually resolved\r\ncontent\r\n" });
  assert.equal(initialConflictResult(conflict), "manually resolved\r\ncontent\r\n");
});

test("an unresolved marker document is replaced by a clean three-way result", () => {
  const conflict = fixture({
    base: "before\nbase value\nafter\n",
    ours: "before\nours value\nafter\n",
    theirs: "before\ntheirs value\nafter\n",
    worktree: "before\n<<<<<<< HEAD\nours value\n=======\ntheirs value\n>>>>>>> topic\nafter\n",
  });
  assert.equal(hasGitConflictMarkers(conflict.worktree), true);
  assert.equal(initialConflictResult(conflict), "before\nbase value\nafter\n");
  assert.doesNotMatch(initialConflictResult(conflict), /<{7}|={7}|>{7}/u);
});

test("marker-aware merge keeps shared add/add context once and removes only conflict payloads", () => {
  const conflict = repeatedAddAddFixture();

  assert.equal(initialConflictResult(conflict), conflict.expectedResult);
  assert.equal(initialConflictResult(conflict).match(/testUsingContext/g)?.length, 2);
  assert.doesNotMatch(initialConflictResult(conflict), /ours|theirs|<{7}|={7}|>{7}/u);
});

test("marker-aware merge accepts wider diff3 markers and keeps their explicit Base payload", () => {
  const conflict = fixture({
    base: "before\nbase value\nafter\n",
    ours: "before\nours value\nafter\n",
    theirs: "before\ntheirs value\nafter\n",
    worktree: "before\n<<<<<<<<< HEAD\nours value\n||||||||| base\nbase value\n=========\ntheirs value\n>>>>>>>>> topic\nafter\n",
  });

  assert.equal(hasGitConflictMarkers(conflict.worktree), true);
  assert.equal(initialConflictResult(conflict), "before\nbase value\nafter\n");
});

test("marker parser ignores a standalone marker-like line before a complete conflict", () => {
  const opening = "<".repeat(7);
  const separator = "=".repeat(7);
  const closing = ">".repeat(7);
  const conflict = fixture({
    base: `${opening} example\nbefore\nbase\nafter\n`,
    ours: `${opening} example\nbefore\nours\nafter\n`,
    theirs: `${opening} example\nbefore\ntheirs\nafter\n`,
    worktree: `${opening} example\nbefore\n${opening} HEAD\nours\n${separator}\ntheirs\n${closing} topic\nafter\n`,
  });

  assert.equal(hasGitConflictMarkers(conflict.worktree), true);
  assert.equal(initialConflictResult(conflict), `${opening} example\nbefore\nbase\nafter\n`);
});

test("three-way merge retains independent edits from both sides", () => {
  assert.equal(
    threeWayMerge(
      "header\nfirst base\nmiddle\nsecond base\nfooter\n",
      "header\nfirst ours\nmiddle\nsecond base\nfooter\n",
      "header\nfirst base\nmiddle\nsecond theirs\nfooter\n",
    ),
    "header\nfirst ours\nmiddle\nsecond theirs\nfooter\n",
  );
});

test("three-way merge retains the base only for overlapping divergent edits", () => {
  assert.equal(
    threeWayMerge("start\nbase\nend\n", "start\nours\nend\n", "start\ntheirs\nend\n"),
    "start\nbase\nend\n",
  );
  assert.equal(
    threeWayMerge("start\nbase\nend\n", "start\nsame\nend\n", "start\nsame\nend\n"),
    "start\nsame\nend\n",
  );
});

test("marker detection requires a complete Git conflict marker sequence", () => {
  assert.equal(hasGitConflictMarkers("const comparison = '=======';\n"), false);
  assert.equal(hasGitConflictMarkers("<<<<<<< example only\ntext\n"), false);
});

function fixture(overrides = {}) {
  return {
    path: "file.txt",
    base: "base\n",
    ours: "ours\n",
    theirs: "theirs\n",
    worktree: null,
    binary: false,
    revisionToken: "revision",
    ...overrides,
  };
}

function repeatedAddAddFixture() {
  const opening = "<".repeat(7);
  const separator = "=".repeat(7);
  const closing = ">".repeat(7);
  const base = "void main() {\n  existing();\n}\n";
  const ours = `void main() {
  existing();

  testUsingContext(() {
    sharedOne();
    oursOne();
  });

  testUsingContext(() {
    sharedTwo();
    oursTwoA();
    oursTwoB();
  });
}
`;
  const theirs = `void main() {
  existing();

  testUsingContext(() {
    sharedOne();
    theirsOneA();
    theirsOneB();
  });

  testUsingContext(() {
    sharedTwo();
    theirsTwo();
  });
}
`;
  const worktree = `void main() {
  existing();

  testUsingContext(() {
    sharedOne();
${opening} HEAD
    oursOne();
${separator}
    theirsOneA();
    theirsOneB();
${closing} topic
  });

  testUsingContext(() {
    sharedTwo();
${opening} HEAD
    oursTwoA();
    oursTwoB();
${separator}
    theirsTwo();
${closing} topic
  });
}
`;
  return {
    ...fixture({ base, ours, theirs, worktree }),
    expectedResult: `void main() {
  existing();

  testUsingContext(() {
    sharedOne();
  });

  testUsingContext(() {
    sharedTwo();
  });
}
`,
  };
}
