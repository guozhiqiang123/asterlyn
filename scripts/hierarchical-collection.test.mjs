import assert from "node:assert/strict";
import test from "node:test";

import {
  DisclosureState,
  HierarchicalCollection,
  collectionAncestors,
  collectionDescendants,
  hierarchicalCollectionNavigation,
  projectVisibleRows,
} from "../src/presentation/hierarchical-collection.ts";
import { renderHierarchicalCollectionToolbar } from "../src/presentation/hierarchical-collection-toolbar.ts";
import { renderHierarchicalCollection } from "../src/presentation/hierarchical-collection-view.ts";

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
  const html = renderHierarchicalCollectionToolbar({ mode: "tree", ariaLabel: "File controls", commands: [{ id: "view<&", elementId: "view", label: "Tree <view>", title: "Switch to flat & list", icon: "chevron-down", pressed: true, active: true, separatorBefore: true }] });
  assert.match(html, /data-collection-command="view&lt;&amp;"/u);
  assert.match(html, /aria-label="Tree &lt;view&gt;"/u);
  assert.match(html, /title="Switch to flat &amp; list"/u);
  assert.match(html, /aria-pressed="true"/u);
  assert.match(html, /id="view"/u);
  assert.match(html, /toolbar-separator/u);
  assert.match(html, /compact-icon-button[^"']*active/u);
  assert.doesNotMatch(html, /onclick|javascript:/iu);
});

const hierarchyNodes = [
  { id: "root", parentId: null, label: "Root", order: 0, role: "branch", defaultExpanded: true },
  { id: "group", parentId: "root", label: "Build", order: 0, role: "branch" },
  { id: "assemble", parentId: "group", label: "assembleDebug", order: 0, role: "leaf" },
  { id: "install", parentId: "group", label: "installDebug", order: 1, role: "leaf" },
  { id: "help", parentId: "root", label: "Help", order: 1, role: "branch" },
  { id: "tasks", parentId: "help", label: "tasks", order: 0, role: "leaf" },
];

test("indexed hierarchy projects tree and flat rows with ARIA sibling metadata and leaf limits", () => {
  const collection = new HierarchicalCollection(hierarchyNodes);
  const disclosure = new DisclosureState({ defaultExpanded: false, exceptions: new Set(["root", "group", "help"]) });
  const tree = collection.project({ disclosure, leafLimit: 2 });
  assert.deepEqual(tree.rows.map(({ node, depth, positionInSet, setSize }) => [node.id, depth, positionInSet, setSize]), [
    ["root", 0, 1, 1],
    ["group", 1, 1, 2],
    ["assemble", 2, 1, 2],
    ["install", 2, 2, 2],
    ["help", 1, 2, 2],
  ]);
  assert.deepEqual({ visible: tree.visibleLeaves, rendered: tree.renderedLeaves, truncated: tree.truncated }, { visible: 3, rendered: 2, truncated: true });
  const flat = collection.project({ mode: "flat", leafLimit: 10 });
  assert.deepEqual(flat.rows.map(({ node, depth, hasChildren }) => [node.id, depth, hasChildren]), [
    ["assemble", 0, false], ["install", 0, false], ["tasks", 0, false],
  ]);
  assert.deepEqual(collection.defaultExpandedIds(), new Set(["root"]));
});

test("filter retains ancestors and expands matching paths without mutating disclosure", () => {
  const collection = new HierarchicalCollection(hierarchyNodes);
  const disclosure = new DisclosureState();
  const filtered = collection.project({ disclosure, forceExpanded: true, filter: (node) => node.label.includes("install") });
  assert.deepEqual(filtered.rows.map((row) => row.node.id), ["root", "group", "install"]);
  assert.equal(disclosure.isExpanded("root"), false);
  const branchMatch = collection.project({ mode: "flat", filter: (node) => node.id === "group" });
  assert.deepEqual(branchMatch.rows.map((row) => row.node.id), ["assemble", "install"]);
});

test("indexed hierarchy rejects duplicate, missing-parent, and unreachable cycles", () => {
  assert.throws(() => new HierarchicalCollection([hierarchyNodes[0], hierarchyNodes[0]]), /Duplicate/u);
  assert.throws(() => new HierarchicalCollection([{ ...hierarchyNodes[0], parentId: "missing" }]), /Missing/u);
  assert.throws(() => new HierarchicalCollection([
    { ...hierarchyNodes[0], id: "a", parentId: "b" },
    { ...hierarchyNodes[1], id: "b", parentId: "a" },
  ]), /unreachable|cycle/u);
});

test("keyboard navigation returns generic focus and disclosure decisions", () => {
  const collection = new HierarchicalCollection(hierarchyNodes);
  const rows = collection.project({ forceExpanded: true }).rows;
  assert.deepEqual(hierarchicalCollectionNavigation(rows, null, "ArrowDown"), { handled: true, focusId: "root" });
  assert.deepEqual(hierarchicalCollectionNavigation(rows, "root", "ArrowRight"), { handled: true, focusId: "group" });
  assert.deepEqual(hierarchicalCollectionNavigation(rows, "assemble", "ArrowLeft"), { handled: true, focusId: "group" });
  const collapsed = collection.project({ disclosure: new DisclosureState() }).rows;
  assert.deepEqual(hierarchicalCollectionNavigation(collapsed, "root", "ArrowRight"), { handled: true, toggleId: "root" });
  assert.deepEqual(hierarchicalCollectionNavigation(rows, "root", "ArrowLeft"), { handled: true, toggleId: "root" });
  assert.deepEqual(hierarchicalCollectionNavigation(rows, "assemble", "End"), { handled: true, focusId: "tasks" });
});

test("shared renderer owns collection roles, row metadata, and escaped host attributes", () => {
  const collection = new HierarchicalCollection(hierarchyNodes);
  const projection = collection.project({ forceExpanded: true });
  const html = renderHierarchicalCollection({
    projection,
    mode: "tree",
    ariaLabel: "Tasks <tree>",
    className: "task-tree",
    renderRow: (row) => ({
      className: row.node.role,
      selected: row.node.id === "assemble",
      attributes: { "data-feature-key": `${row.node.id}\"` },
      content: `<span>${row.node.label}</span>`,
    }),
  });
  assert.match(html, /role="tree"/u);
  assert.match(html, /aria-label="Tasks &lt;tree&gt;"/u);
  assert.match(html, /data-collection-node-id="assemble"/u);
  assert.match(html, /aria-level="3"/u);
  assert.match(html, /aria-selected="true"/u);
  assert.match(html, /data-feature-key="assemble&quot;"/u);
});
