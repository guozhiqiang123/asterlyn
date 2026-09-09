import assert from "node:assert/strict";
import test from "node:test";

import { demoQueryHistory, demoSnapshot } from "../src/demo.ts";

const query = (overrides = {}) => ({
  repositoryIds: [],
  refs: [],
  authorEmails: [],
  currentAuthor: false,
  sinceEpoch: null,
  paths: [],
  firstParent: false,
  excludeMerges: false,
  order: "topological",
  ...overrides,
});

test("demo history exercises multi-ref, author, path, and traversal controls", () => {
  assert.equal(demoQueryHistory(demoSnapshot, query()).length, 7);
  assert.equal(
    demoQueryHistory(
      demoSnapshot,
      query({ refs: [ref("refs/heads/main"), ref("refs/heads/feature/graph-rendering")] }),
    ).length,
    2,
  );
  assert.equal(
    demoQueryHistory(
      demoSnapshot,
      query({ authorEmails: ["contributor@example.invalid"] }),
    ).length,
    1,
  );
  assert.equal(
    demoQueryHistory(
      demoSnapshot,
      query({ paths: [path("crates/asterlyn-git/src/repository.rs")] }),
    ).length,
    6,
  );

  const selectedRef = [ref("refs/heads/feature/git-workbench")];
  assert.equal(demoQueryHistory(demoSnapshot, query({ refs: selectedRef })).length, 7);
  assert.equal(
    demoQueryHistory(demoSnapshot, query({ refs: selectedRef, firstParent: true })).length,
    6,
  );
  assert.equal(
    demoQueryHistory(
      demoSnapshot,
      query({ refs: selectedRef, firstParent: true, excludeMerges: true }),
    ).length,
    5,
  );
});

function ref(fullName) {
  return { repositoryId: ".", fullName };
}

function path(value) {
  return { repositoryId: ".", path: value };
}
