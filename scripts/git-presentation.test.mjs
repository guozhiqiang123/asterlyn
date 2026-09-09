import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCommitFileTree,
  commitReferences,
  groupRemoteBranches,
  projectCommitGraph,
} from "../src/workbench/git-presentation.ts";

test("commit decorations become truthful semantic references", () => {
  assert.deepEqual(
    commitReferences(
      ["HEAD -> feature/topic", "origin/main", "tag: v1.0", "feature/topic"],
      [
        { kind: "local", name: "feature/topic" },
        { kind: "remote", name: "origin/main" },
      ],
    ),
    [
      { kind: "head", label: "HEAD" },
      { kind: "local", label: "feature/topic" },
      { kind: "remote", label: "origin/main" },
      { kind: "tag", label: "v1.0" },
    ],
  );
});

test("unknown and symbolic decorations are never guessed from slash characters", () => {
  assert.deepEqual(commitReferences(["release/topic", "origin/HEAD -> origin/main"]), [
    { kind: "other", label: "release/topic" },
    { kind: "other", label: "origin/HEAD" },
    { kind: "other", label: "origin/main" },
  ]);
});

test("commit files project to a directory-first tree without losing file state", () => {
  const files = [
    file("README.md", "modified"),
    file("src/zeta.ts", "deleted"),
    file("src/app/main.ts", "added"),
    file("src/alpha.ts", "renamed"),
  ];
  const tree = buildCommitFileTree(files);
  assert.deepEqual(
    tree.map((node) => [node.kind, node.name]),
    [
      ["directory", "src"],
      ["file", "README.md"],
    ],
  );
  assert.deepEqual(
    tree[0].children.map((node) => [node.kind, node.name]),
    [
      ["directory", "app"],
      ["file", "alpha.ts"],
      ["file", "zeta.ts"],
    ],
  );
  assert.equal(tree[0].children[0].children[0].file, files[2]);
});

test("remote refs group by remote and retain exact selectable refs", () => {
  const branches = [
    branch("refs/remotes/upstream/release", "upstream/release"),
    branch("refs/remotes/origin/main", "origin/main"),
    branch("refs/remotes/origin/HEAD", "origin/HEAD"),
  ];
  const groups = groupRemoteBranches(branches);
  assert.deepEqual(
    groups.map((group) => [
      group.name,
      group.branches.map(({ branch: item, displayName }) => [item.fullName, displayName]),
    ]),
    [
      [
        "origin",
        [
          ["refs/remotes/origin/HEAD", "HEAD"],
          ["refs/remotes/origin/main", "main"],
        ],
      ],
      ["upstream", [["refs/remotes/upstream/release", "release"]]],
    ],
  );
});

test("commit graph keeps a linear history in one lane", () => {
  const graph = projectCommitGraph([
    commit("tip", ["root"]),
    commit("root", []),
  ]);

  assert.equal(graph.laneCount, 1);
  assert.deepEqual(
    graph.rows.map(({ oid, nodeLane, parentCount }) => [oid, nodeLane, parentCount]),
    [
      ["tip", 0, 1],
      ["root", 0, 0],
    ],
  );
  assert.deepEqual(
    graph.rows[0].segments.map(({ kind, fromLane, toLane }) => [
      kind,
      fromLane,
      toLane,
    ]),
    [["parent", 0, 0]],
  );
  assert.deepEqual(
    graph.rows[1].segments.map(({ kind, fromLane, toLane }) => [
      kind,
      fromLane,
      toLane,
    ]),
    [["incoming", 0, 0]],
  );
});

test("commit graph fans out a merge and converges at the shared parent", () => {
  const graph = projectCommitGraph([
    commit("merge", ["main", "side"]),
    commit("main", ["root"]),
    commit("side", ["root"]),
    commit("root", []),
  ]);

  assert.equal(graph.laneCount, 2);
  assert.equal(graph.rows[0].parentCount, 2);
  assert.deepEqual(
    graph.rows[0].segments
      .filter(({ kind }) => kind === "parent")
      .map(({ fromLane, toLane }) => [fromLane, toLane]),
    [
      [0, 0],
      [0, 1],
    ],
  );
  assert.ok(
    graph.rows[1].segments.some(
      ({ kind, fromLane, toLane }) =>
        kind === "through" && fromLane === 1 && toLane === 1,
    ),
  );
  assert.equal(graph.rows[2].nodeLane, 1);
  assert.ok(
    graph.rows[2].segments.some(
      ({ kind, fromLane, toLane }) =>
        kind === "parent" && fromLane === 1 && toLane === 0,
    ),
  );
  assert.equal(graph.rows[3].nodeLane, 0);
});

test("commit graph does not infer ancestry from adjacent unrelated rows", () => {
  const graph = projectCommitGraph([
    commit("visible-tip", ["hidden-parent"]),
    commit("unrelated", []),
  ]);

  assert.equal(graph.rows[1].startsLane, true);
  assert.equal(graph.rows[1].nodeLane, 1);
  assert.equal(
    graph.rows[1].segments.some(
      ({ kind, fromLane }) => kind === "parent" && fromLane === 0,
    ),
    false,
  );
});

function file(path, status) {
  return { path, originalPath: null, status };
}

function branch(fullName, name) {
  return {
    fullName,
    name,
    oid: "1".repeat(40),
    current: false,
    kind: "remote",
    upstream: null,
    tracking: null,
    committedAt: 1,
    subject: "subject",
  };
}

function commit(oid, parents) {
  return { oid, parents };
}
