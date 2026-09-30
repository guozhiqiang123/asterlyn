import assert from "node:assert/strict";
import test from "node:test";

import { GitHistoryMutationRuntime } from "../src/features/git-history/git-history-mutation-runtime.ts";

test("Git History mutation runtime owns both reviewed dialog lifecycles", () => {
  let queries = 0;
  const runtime = new GitHistoryMutationRuntime({
    root: {
      querySelector: () => {
        queries += 1;
        return null;
      },
    },
    branch: {
      gateway: {},
      copy: () => ({}),
    },
    worktree: { gateway: {}, copy: () => ({}) },
    tag: { gateway: {}, copy: () => ({}) },
    fileRestore: {
      gateway: {},
      copy: () => ({}),
    },
  });

  runtime.branch.open("/repo", "create", {
    repositoryId: ".",
    fullName: "refs/heads/main",
    name: "main",
    oid: "a".repeat(40),
  });
  runtime.tag.open({ repositoryRoot: "/repo", commitOid: "a".repeat(40), commitSubject: "A" }, "create");
  runtime.fileRestore.reset();
  assert.equal(queries, 3);

  runtime.dispose();
  runtime.dispose();
  runtime.branch.open("/repo", "create", {
    repositoryId: ".",
    fullName: "refs/heads/main",
    name: "main",
    oid: "a".repeat(40),
  });
  runtime.tag.open({ repositoryRoot: "/repo", commitOid: "a".repeat(40), commitSubject: "A" }, "create");
  runtime.fileRestore.reset();
  assert.equal(queries, 3);
  assert.equal(runtime.fileRestore.state.dialog, null);
});
