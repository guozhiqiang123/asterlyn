import assert from "node:assert/strict";
import test from "node:test";

import {
  effectiveHistoryRootIds,
  toggleHistoryRootSelection,
} from "../src/workbench/history-root-selection.ts";

const roots = [".", "superboost", "vaLib"];

test("empty root query renders every module as selected", () => {
  assert.deepEqual(
    Array.from(effectiveHistoryRootIds(roots, new Set())),
    roots,
  );
});

test("unchecking modules narrows the explicit root selection", () => {
  const withoutSuperboost = toggleHistoryRootSelection(
    roots,
    new Set(),
    "superboost",
    false,
  );
  assert.deepEqual(Array.from(withoutSuperboost), [".", "vaLib"]);

  const mainOnly = toggleHistoryRootSelection(
    roots,
    withoutSuperboost,
    "vaLib",
    false,
  );
  assert.deepEqual(Array.from(mainOnly), ["."]);
});

test("the final module stays selected and selecting all restores the all-roots query", () => {
  assert.deepEqual(
    Array.from(toggleHistoryRootSelection(roots, new Set(["."]), ".", false)),
    ["."],
  );

  const all = toggleHistoryRootSelection(
    roots,
    new Set([".", "superboost"]),
    "vaLib",
    true,
  );
  assert.equal(all.size, 0);
});
