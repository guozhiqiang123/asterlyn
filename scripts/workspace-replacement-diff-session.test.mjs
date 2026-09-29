import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWorkspaceReplacementActionDocument,
  replacementActionForChunk,
} from "../src/features/files-editor/workspace-replacement-diff-session.ts";

test("a pending reviewed replacement is projected as a Replace action", () => {
  const document = buildWorkspaceReplacementActionDocument(
    "const value = 'abc';\n",
    "const value = 'xyz';\n",
    "const value = 'abc';\n",
  );
  assert.equal(document.content, "const value = 'xyz';\n");
  assert.deepEqual(document.actions.map((action) => action.kind), ["replace"]);
  const action = document.actions[0];
  assert.equal(replacementActionForChunk({ fromB: action.from, toB: action.to }, document.actions), "replace");
});

test("an applied replacement is projected back to the session baseline as Rollback", () => {
  const document = buildWorkspaceReplacementActionDocument(
    "const value = 'abc';\n",
    "const value = 'xyz';\n",
    "const value = 'xyz';\n",
  );
  assert.equal(document.content, "const value = 'abc';\n");
  assert.deepEqual(document.actions.map((action) => action.kind), ["rollback"]);
});

test("manual edits and pending replacements remain independent actions", () => {
  const document = buildWorkspaceReplacementActionDocument(
    "first\nabc\nlast\n",
    "first\nxyz\nlast\n",
    "FIRST\nabc\nlast\n",
  );
  assert.equal(document.content, "first\nxyz\nlast\n");
  assert.deepEqual(new Set(document.actions.map((action) => action.kind)), new Set(["replace", "rollback"]));
});
