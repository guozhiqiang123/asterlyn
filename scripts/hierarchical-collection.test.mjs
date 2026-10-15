import assert from "node:assert/strict";
import test from "node:test";

import { DisclosureState, collectionAncestors, collectionDescendants, projectVisibleRows } from "../src/presentation/hierarchical-collection.ts";
import { renderHierarchicalCollectionToolbar } from "../src/presentation/hierarchical-collection-toolbar.ts";

const nodes = [
  { id: "root", parentId: null, label: "Root", order: 0 },
  { id: "child", parentId: "root", label: "Child", order: 0 },
  { id: "leaf", parentId: "child", label: "Leaf", order: 0 },
  { id: "other", parentId: null, label: "Other", order: 1 },
];

test("disclosure supports O(1) all operations, toggle, subtree, and reconcile", () => {
  const disclosure = new DisclosureState();
  assert.deepEqual(projectVisibleRows(nodes, "tree", disclosure).map((row) => row.node.id), ["root", "other"]);
  disclosure.toggle("root");
  assert.deepEqual(projectVisibleRows(nodes, "tree", disclosure).map((row) => row.node.id), ["root", "child", "other"]);
  disclosure.setSubtreeExpanded("root", true, nodes);
  assert.deepEqual(projectVisibleRows(nodes, "tree", disclosure).map((row) => row.node.id), ["root", "child", "leaf", "other"]);
  disclosure.collapseAll();
  assert.deepEqual(projectVisibleRows(nodes, "tree", disclosure).map((row) => row.node.id), ["root", "other"]);
  disclosure.expandAll();
  disclosure.reconcile(nodes.filter((node) => node.id !== "child"));
  assert.deepEqual(disclosure.snapshot.exceptions, new Set());
});

test("flat projection and ancestor/descendant queries preserve stable order", () => {
  assert.deepEqual(projectVisibleRows(nodes, "flat", new DisclosureState()).map((row) => row.node.id), ["root", "child", "leaf", "other"]);
  assert.deepEqual(collectionAncestors("leaf", nodes).map((node) => node.id), ["root", "child"]);
  assert.deepEqual(collectionDescendants("root", nodes).map((node) => node.id), ["child", "leaf"]);
});

test("toolbar renders declaration-only command IDs and escapes labels", () => {
  const html = renderHierarchicalCollectionToolbar({ mode: "tree", ariaLabel: "File controls", commands: [{ id: "view<&", elementId: "view", label: "Tree <view>", icon: "chevron-down", pressed: true, active: true }] });
  assert.match(html, /data-collection-command="view&lt;&amp;"/u);
  assert.match(html, /aria-label="Tree &lt;view&gt;"/u);
  assert.match(html, /aria-pressed="true"/u);
  assert.match(html, /id="view"/u);
  assert.match(html, /compact-icon-button[^"']*active/u);
  assert.doesNotMatch(html, /onclick|javascript:/iu);
});
