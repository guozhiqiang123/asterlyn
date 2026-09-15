import assert from "node:assert/strict";
import test from "node:test";

import { remapEditorCacheEntries } from "../src/workbench/editor-cache-remap.ts";

test("text editor cache remaps identity without replacing CodeMirror state", () => {
  const entries = new Map();
  const state = { history: "preserved", selection: { anchor: 4 } };
  const cached = { id: "old", path: "src/a.ts", state, view: null };
  entries.set("old", cached);

  const result = remapEditorCacheEntries(entries, "old", [{
    sourceId: "old",
    destinationId: "new",
    destinationPath: "lib/a.ts",
  }]);
  assert.deepEqual(result, { status: "applied", activeId: "new" });
  assert.equal(entries.has("old"), false);
  assert.equal(entries.get("new"), cached);
  assert.equal(entries.get("new").state, state);
  assert.equal(entries.get("new").path, "lib/a.ts");
});

test("text editor cache rejects an unrelated occupied destination", () => {
  const entries = new Map();
  const source = { id: "old", path: "a.ts" };
  const destination = { id: "new", path: "b.ts" };
  entries.set("old", source);
  entries.set("new", destination);

  assert.deepEqual(remapEditorCacheEntries(entries, null, [{
    sourceId: "old",
    destinationId: "new",
    destinationPath: "b.ts",
  }]), { status: "conflict" });
  assert.equal(entries.get("old"), source);
  assert.equal(entries.get("new"), destination);
});
