import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTaskTree,
  TASK_TREE_ROOT_KEY,
  taskTreeBranchKeys,
  taskTreeDefaultExpandedKeys,
  taskTreeRows,
} from "../src/features/tasks/tasks-tree.ts";

const entry = (providerId, id, group, projectPath) => ({
  key: `${providerId}:${id}`,
  providerId,
  providerLabel: providerId === "gradle" ? "Gradle" : providerId,
  task: { id, label: id, group, projectPath, runnable: true },
});

test("default expansion reveals each project Tasks folder but keeps task groups collapsed", () => {
  const tree = buildTaskTree([
    entry("gradle", ":help", "Help tasks", ":"),
    entry("gradle", ":app:installDebug", "Install tasks", ":app"),
  ], "/repo/FilesRecovery", "Tasks");
  const defaults = taskTreeDefaultExpandedKeys(tree);
  const rows = taskTreeRows(tree, defaults, 250);
  assert.deepEqual(rows.rows.map((row) => row.node.label), [
    "FilesRecovery", "Tasks", "help", "app", "Tasks", "install",
  ]);
  assert.equal(rows.visibleTasks, 0);
  assert.equal([...defaults].some((key) => key.includes(":group:")), false);
});

test("builds workspace, root tasks, module tasks, groups, and exact task leaves", () => {
  const tree = buildTaskTree([
    entry("gradle", ":help", "Help tasks", ":"),
    entry("gradle", ":app:assembleDebug", "Build tasks", ":app"),
    entry("gradle", ":app:installDebug", "Install tasks", ":app"),
    entry("gradle", ":feature:sub:lint", "Verification tasks", ":feature:sub"),
  ], "/repo/FilesRecovery", "Tasks");
  assert.equal(tree.key, TASK_TREE_ROOT_KEY);
  assert.equal(tree.label, "FilesRecovery");
  assert.deepEqual(tree.children.map((node) => [node.kind, node.label]), [
    ["tasks", "Tasks"],
    ["module", "app"],
    ["module", "feature:sub"],
  ]);
  const app = tree.children[1];
  assert.deepEqual(app.children[0].children.map((group) => group.label), ["build", "install"]);
  assert.equal(app.children[0].children[0].children[0].label, "assembleDebug");
  assert.equal(app.children[0].children[0].children[0].entry.task.id, ":app:assembleDebug");
});

test("flattening respects expansion, bounds task leaves, and keeps stable branch keys", () => {
  const entries = Array.from({ length: 600 }, (_, index) => entry("gradle", `:app:task${index}`, "Other tasks", ":app"));
  const tree = buildTaskTree(entries, "/repo/FilesRecovery", "Tasks");
  const collapsed = taskTreeRows(tree, new Set([TASK_TREE_ROOT_KEY]), 250);
  assert.deepEqual(collapsed.rows.map((row) => row.node.label), ["FilesRecovery", "app"]);
  assert.equal(collapsed.visibleTasks, 0);

  const expanded = taskTreeBranchKeys(tree);
  const rows = taskTreeRows(tree, expanded, 250);
  assert.equal(rows.renderedTasks, 250);
  assert.equal(rows.visibleTasks, 600);
  assert.equal(rows.truncated, true);
  assert.equal(rows.rows.filter((row) => row.node.type === "task").length, 250);
  assert.equal(expanded.has(TASK_TREE_ROOT_KEY), true);
});

test("force-expanded search projections show every matching ancestor without changing expansion state", () => {
  const match = entry("gradle", ":app:installDebug", "Install tasks", ":app");
  const tree = buildTaskTree([match], "C:\\work\\FilesRecovery", "Tasks");
  const expanded = new Set([TASK_TREE_ROOT_KEY]);
  const rows = taskTreeRows(tree, expanded, 250, true);
  assert.deepEqual(rows.rows.map((row) => row.node.label), ["FilesRecovery", "app", "Tasks", "install", "installDebug"]);
  assert.deepEqual([...expanded], [TASK_TREE_ROOT_KEY]);
});

test("provider identity keeps same-name module and task nodes distinct", () => {
  const tree = buildTaskTree([
    entry("gradle", ":app:build", "Build tasks", ":app"),
    entry("other", ":app:build", "Build tasks", ":app"),
  ], "/repo", "Tasks");
  const modules = tree.children.filter((node) => node.kind === "module");
  assert.equal(modules.length, 2);
  assert.notEqual(modules[0].key, modules[1].key);
  const keys = modules.map((module) => module.children[0].children[0].children[0].key);
  assert.notEqual(keys[0], keys[1]);
});
