import assert from "node:assert/strict";
import test from "node:test";

import { DiffContextExpansionState } from "../src/features/files-editor/diff-context-expansion.ts";

const first = {
  kind: "commit-diff",
  repositoryRoot: "/repo",
  repositoryId: ".",
  oid: "abc123",
  path: "src/first.ts",
};
const second = { ...first, path: "src/second.ts" };

test("an omitted section expands independently and reprojects later sections locally", () => {
  const state = new DiffContextExpansionState();

  assert.equal(state.requestsExpandedPatch(first), false);
  assert.equal(state.projectionKey(first), "compact");
  assert.equal(state.expand(first, "40:80:40:80"), "reload");
  assert.equal(state.requestsExpandedPatch(first), true);
  assert.deepEqual(state.sections(first), ["40:80:40:80"]);
  assert.equal(state.expand(first, "40:80:40:80"), "none");
  assert.equal(state.expand(first, "100:120:100:120"), "render");
  assert.deepEqual(state.sections(first), ["100:120:100:120", "40:80:40:80"]);
});

test("the toolbar promotes a partial expansion to all lines then collapses it", () => {
  const state = new DiffContextExpansionState();

  assert.equal(state.expand(first, "40:80:40:80"), "reload");
  assert.equal(state.toggle(first), "render");
  assert.equal(state.isFullyExpanded(first), true);
  assert.deepEqual(state.sections(first), []);
  assert.equal(state.projectionKey(first), "all");
  assert.equal(state.toggle(first), "reload");
  assert.equal(state.requestsExpandedPatch(first), false);
  assert.equal(state.projectionKey(first), "compact");
});

test("partial expansions stay scoped to their document", () => {
  const state = new DiffContextExpansionState();

  assert.equal(state.expand(first, "40:80:40:80"), "reload");
  assert.equal(state.requestsExpandedPatch(second), false);
  assert.deepEqual(state.sections(second), []);
  assert.equal(state.expand(second, "10:20:10:20"), "reload");
  assert.equal(state.requestsExpandedPatch(first), false);
  assert.deepEqual(state.sections(second), ["10:20:10:20"]);
});
