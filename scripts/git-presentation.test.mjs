import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCommitFileTree,
  commitReferences,
  groupRemoteBranches,
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
