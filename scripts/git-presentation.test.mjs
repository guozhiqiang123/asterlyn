import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCommitFileTree,
  commitReferences,
  groupRemoteBranches,
  matchingLogicalBranches,
  projectCommitGraph,
  uniqueLogicalBranches,
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
  assert.equal(graph.rows[1].nodeLane, 0);
  assert.equal(
    graph.rows[1].segments.some(
      ({ kind, fromLane }) => kind === "parent" && fromLane === 0,
    ),
    false,
  );
  assert.equal(graph.laneCount, 1);
});

test("commit graph retires omitted parents instead of accumulating phantom lanes", () => {
  const commits = Array.from({ length: 150 }, (_, index) =>
    commit(`visible-${index}`, [`hidden-${index}`]),
  );
  const graph = projectCommitGraph(commits);

  assert.equal(graph.laneCount, 1);
  assert.ok(graph.rows.every(({ startsLane }) => startsLane));
});

test("single-ref filtered graph bridges omitted parents through visible commits", () => {
  const graph = projectCommitGraph(
    [
      commit("newest", ["hidden-a"]),
      commit("middle", ["hidden-b"]),
      commit("oldest", []),
    ],
    { bridgeOmittedParents: true },
  );

  assert.equal(graph.laneCount, 1);
  assert.deepEqual(graph.rows.map(({ startsLane }) => startsLane), [true, false, false]);
  assert.ok(graph.rows[0].segments.some(({ kind }) => kind === "parent"));
  assert.ok(graph.rows[1].segments.some(({ kind }) => kind === "parent"));
});

test("logical branch choices combine the same ref across selected Git roots", () => {
  const branches = [
    { ...branch("refs/heads/dev", "dev"), repositoryId: ".", kind: "local" },
    { ...branch("refs/heads/dev", "dev"), repositoryId: "module", kind: "local" },
    { ...branch("refs/heads/other", "other"), repositoryId: "module", kind: "local" },
  ];

  assert.deepEqual(
    uniqueLogicalBranches(branches).map(({ fullName }) => fullName),
    ["refs/heads/dev", "refs/heads/other"],
  );
  assert.deepEqual(
    matchingLogicalBranches(branches, branches[0], new Set([".", "module"])).map(
      ({ repositoryId }) => repositoryId,
    ),
    [".", "module"],
  );
  assert.deepEqual(
    matchingLogicalBranches(branches, branches[0], new Set(["module"])).map(
      ({ repositoryId }) => repositoryId,
    ),
    ["module"],
  );
});

test("commit graph never connects identical object IDs across Git roots", () => {
  const graph = projectCommitGraph([
    commit("shared", ["parent"], "."),
    commit("shared", ["parent"], "modules/library"),
    commit("parent", [], "."),
    commit("parent", [], "modules/library"),
  ]);

  assert.equal(graph.rows[0].startsLane, true);
  assert.equal(graph.rows[1].startsLane, true);
  assert.notEqual(graph.rows[0].nodeLane, graph.rows[1].nodeLane);
  assert.equal(graph.rows[2].nodeColor, graph.rows[0].nodeColor);
  assert.equal(graph.rows[3].nodeColor, graph.rows[1].nodeColor);
  assert.notEqual(graph.rows[2].nodeColor, graph.rows[3].nodeColor);
});

function file(path, status) {
  return { path, originalPath: null, status };
}

function branch(fullName, name) {
  return {
    repositoryId: ".",
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

function commit(oid, parents, repositoryId = ".") {
  return { repositoryId, oid, parents };
}
