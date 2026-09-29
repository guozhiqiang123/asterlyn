import assert from "node:assert/strict";
import test from "node:test";

import { Change, Chunk } from "@codemirror/merge";
import { Text } from "@codemirror/state";
import {
  LINE_AWARE_DIFF_CONFIG,
  lineAwareDiff,
} from "../src/features/files-editor/line-aware-diff.ts";

test("line-aware diff keeps isolated insertions separate in a large source file", () => {
  const beforeLines = Array.from({ length: 8_000 }, (_, index) => `const value${index} = ${index};`);
  const afterLines = [...beforeLines];
  afterLines.splice(67, 0, 'import { StashRuntime } from "./stash-runtime.ts";');
  afterLines.splice(2_100, 1, "const value2099 = calculateUpdatedValue();");
  afterLines.splice(5_300, 0, "function addedLater() { return true; }");
  afterLines.splice(6_700, 3);
  const before = `${beforeLines.join("\n")}\n`;
  const after = `${afterLines.join("\n")}\n`;

  const started = performance.now();
  const chunks = Chunk.build(text(before), text(after), LINE_AWARE_DIFF_CONFIG);
  const elapsed = performance.now() - started;

  assert.equal(applyChanges(before, after, lineAwareDiff(before, after)), after);
  assert.equal(chunks.length, 4);
  assert.ok(chunks.every((chunk) => chunk.toA - chunk.fromA < 160));
  assert.ok(chunks.every((chunk) => chunk.toB - chunk.fromB < 160));
  assert.ok(elapsed < 500, `large source diff took ${elapsed.toFixed(1)}ms`);
});

test("line-aware diff preserves precise inline ranges inside changed lines", () => {
  const before = "const status = oldValue;\nconst stable = true;\n";
  const after = "const status = newValue;\nconst stable = true;\n";
  const changes = lineAwareDiff(before, after);

  assert.equal(applyChanges(before, after, changes), after);
  assert.equal(changes.length, 1);
  assert.equal(before.slice(changes[0].fromA, changes[0].toA), "old");
  assert.equal(after.slice(changes[0].fromB, changes[0].toB), "new");
});

test("line-aware diff preserves an unchanged identifier suffix after unequal replacement", () => {
  const before = 'oid: "0123456789abcdef",\n';
  const after = 'oid: "0123456789textxyzdef",\n';
  const changes = lineAwareDiff(before, after);

  assert.equal(applyChanges(before, after, changes), after);
  assert.equal(changes.length, 1);
  assert.equal(before.slice(changes[0].fromA, changes[0].toA), "abc");
  assert.equal(after.slice(changes[0].fromB, changes[0].toB), "textxyz");
});

test("line-aware diff pairs adjacent CSS declarations before highlighting changed values", () => {
  const before = [
    ".commit-file-glyph {",
    "  display: grid;",
    "  width: 18px;",
    "  height: 18px;",
    "  place-items: center;",
    "}",
  ].join("\n");
  const after = [
    ".commit-file-glyph {",
    "  display: grid;",
    "  width: 17px;",
    "  height: 17px;",
    "  place-items: center;",
    "}",
  ].join("\n");
  const changes = lineAwareDiff(before, after);

  assert.equal(applyChanges(before, after, changes), after);
  assert.deepEqual(changes.map((change) => ({
    old: before.slice(change.fromA, change.toA),
    next: after.slice(change.fromB, change.toB),
  })), [
    { old: "8", next: "7" },
    { old: "8", next: "7" },
  ]);
});

test("line-aware diff keeps CSS property names stable when values have different lengths", () => {
  const before = [
    "  gap: 4px;",
    "  border-radius: 3px;",
    "  color: var(--text-soft);",
  ].join("\n");
  const after = [
    "  gap: var(--compact-file-tree-row-gap);",
    "  border-radius: var(--compact-file-tree-row-radius);",
    "  color: var(--compact-file-tree-color);",
  ].join("\n");
  const changes = lineAwareDiff(before, after);

  assert.equal(applyChanges(before, after, changes), after);
  for (const change of changes) {
    assert.doesNotMatch(before.slice(change.fromA, change.toA), /gap:|border-radius:|color:/u);
    assert.doesNotMatch(after.slice(change.fromB, change.toB), /gap:|border-radius:|color:/u);
  }
});

test("line-aware diff pairs a rewritten signature before independent added methods", () => {
  const before = [
    "async listWorkspaceMutationRecoveries(",
    "  repositoryRoot: string,",
    "): Promise<Recovery[]> {",
    "  if (!isTauri) return [];",
    "  return invoke(repositoryRoot);",
    "}",
    "async searchWorkspaceText() {}",
  ].join("\n");
  const after = [
    "async listWorkspaceMutationRecoveries(repositoryRoot: string): Promise<Recovery[]>;",
    "async rollbackWorkspaceMutation(repositoryRoot: string): Promise<void>;",
    "async finalizeWorkspaceMutation(repositoryRoot: string): Promise<void>;",
    "async acknowledgeWorkspaceMutationRecovery(repositoryRoot: string): Promise<void>;",
    "async searchWorkspaceText() {}",
  ].join("\n");
  const changes = lineAwareDiff(before, after);

  assert.equal(applyChanges(before, after, changes), after);
  assert.equal(changes.some((change) =>
    before.slice(change.fromA, change.toA).includes("listWorkspaceMutationRecoveries") ||
    after.slice(change.fromB, change.toB).includes("listWorkspaceMutationRecoveries")
  ), false);
  assert.ok(changes.some((change) =>
    change.fromA === change.toA && after.slice(change.fromB, change.toB).includes("rollbackWorkspaceMutation")
  ));
  assert.ok(changes.some((change) =>
    change.fromB === change.toB && before.slice(change.fromA, change.toA).includes("if (!isTauri)")
  ));
});

test("line-aware diff remains exact with repeated lines and missing final newlines", () => {
  const before = "start\nrepeat\nrepeat\nold\nend";
  const after = "start\nrepeat\nnew\nrepeat\nend\n";
  const changes = lineAwareDiff(before, after);
  assert.equal(applyChanges(before, after, changes), after);
});

function text(value) {
  return Text.of(value.split("\n"));
}

function applyChanges(before, after, changes) {
  let result = "";
  let cursor = 0;
  for (const change of changes) {
    assert.ok(change instanceof Change);
    assert.ok(change.fromA >= cursor);
    result += before.slice(cursor, change.fromA);
    result += after.slice(change.fromB, change.toB);
    cursor = change.toA;
  }
  return result + before.slice(cursor);
}
