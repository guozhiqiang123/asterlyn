import assert from "node:assert/strict";
import test from "node:test";

import { normalizeHierarchicalCollection } from "../src/application/plugins/plugin-collection-adapter.ts";

const node = (id, parentId, order, kind = "group", taskId) => ({ id, parentId, label: id, kind, order, ...(taskId === undefined ? {} : { taskId }) });

test("normalizes a deterministic tree into depth-aware rows", () => {
  const result = normalizeHierarchicalCollection({
    providerId: "gradle",
    truncated: false,
    nodes: [node("app", null, 0), node("app.build", "app", 0, "task", ":app:build"), node("app.test", "app", 1, "task", ":app:test")],
  });
  assert.deepEqual(result.rows.map(({ id, depth, taskId }) => ({ id, depth, taskId })), [
    { id: "app", depth: 0, taskId: undefined },
    { id: "app.build", depth: 1, taskId: ":app:build" },
    { id: "app.test", depth: 1, taskId: ":app:test" },
  ]);
});

test("sorts siblings by order then stable ID and rejects duplicate order", () => {
  const result = normalizeHierarchicalCollection({ providerId: "tasks", truncated: false, nodes: [node("z", null, 1), node("a", null, 0)] });
  assert.deepEqual(result.rows.map((row) => row.id), ["a", "z"]);
  assert.throws(() => normalizeHierarchicalCollection({ providerId: "tasks", truncated: false, nodes: [node("a", null, 0), node("b", null, 0)] }), /order/u);
});

test("rejects cycles, missing parents, duplicate task IDs, and unsafe metadata", () => {
  assert.throws(() => normalizeHierarchicalCollection({ providerId: "tasks", truncated: false, nodes: [node("a", "b", 0), node("b", "a", 0)] }), /cycle|unreachable/u);
  assert.throws(() => normalizeHierarchicalCollection({ providerId: "tasks", truncated: false, nodes: [node("a", "missing", 0)] }), /parent/u);
  assert.throws(() => normalizeHierarchicalCollection({ providerId: "tasks", truncated: false, nodes: [node("a", null, 0, "task", ":same"), node("b", null, 1, "task", ":same")] }), /taskId/u);
  assert.throws(() => normalizeHierarchicalCollection({ providerId: "tasks", truncated: false, nodes: [{ ...node("a", null, 0), metadata: { bad: "\0" } }] }), /metadata/u);
});

test("rejects depth, node, label, and unstable ID bounds", () => {
  assert.throws(() => normalizeHierarchicalCollection({ providerId: "tasks", truncated: false, nodes: [node("bad id", null, 0)] }), /stable/u);
  assert.throws(() => normalizeHierarchicalCollection({ providerId: "tasks", truncated: false, nodes: [{ ...node("a", null, 0), label: "" }] }), /label/u);
  const deep = Array.from({ length: 66 }, (_, index) => node(`n${index}`, index === 0 ? null : `n${index - 1}`, 0));
  assert.throws(() => normalizeHierarchicalCollection({ providerId: "tasks", truncated: false, nodes: deep }), /depth/u);
});
