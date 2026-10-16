import assert from "node:assert/strict";
import test from "node:test";

import {
  activityToolAvailability,
  reconcileActivityLayout,
} from "../src/shell/activity-availability.ts";
import { WORKBENCH_LAYOUT_DEFAULTS } from "../src/shell/layout-state.ts";

const availability = (tool, overrides = {}) => {
  const state = { workspaceOpen: true, gitAvailable: false, tasksAvailable: false, ...overrides };
  return activityToolAvailability(tool, state.workspaceOpen, state.gitAvailable, state.tasksAvailable);
};

test("optional plugin tools stay hidden until an active contribution backs them", () => {
  assert.equal(availability("tasks"), -1);
  assert.equal(availability("tasks", { tasksAvailable: true }), 1);
  assert.equal(availability("tasks", { workspaceOpen: false, tasksAvailable: true }), -1);
});

test("core workspace and Git tool availability remains host-owned", () => {
  assert.equal(availability("files"), 1);
  assert.equal(availability("branches"), 0);
  assert.equal(availability("branches", { gitAvailable: true }), 1);
  assert.equal(availability("terminal", { workspaceOpen: false }), 0);
});

test("losing an optional contribution closes only its visible surface", () => {
  const tasksOpen = { ...WORKBENCH_LAYOUT_DEFAULTS, leftTool: "files", bottomTool: "tasks" };
  const reconciled = reconcileActivityLayout(tasksOpen, false);
  assert.equal(reconciled.leftTool, "files");
  assert.equal(reconciled.bottomTool, null);

  assert.equal(reconcileActivityLayout(tasksOpen, true), tasksOpen);
  const gitOpen = { ...WORKBENCH_LAYOUT_DEFAULTS, bottomTool: "branches" };
  assert.equal(reconcileActivityLayout(gitOpen, false), gitOpen);
});
