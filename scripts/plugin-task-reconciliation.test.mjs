import assert from "node:assert/strict";
import test from "node:test";

import { reconcileAfterSuccessfulTask } from "../src/composition/post-task-reconciliation.ts";

const identity = { root: "/repo", generation: 7 };

test("successful tasks reconcile files, untracked state, then tracked state", async () => {
  const events = [];
  await reconcileAfterSuccessfulTask(identity, {
    matches: () => true,
    filesRoot: () => "/repo",
    refreshFiles: async () => { events.push("files"); },
    activateWatch: () => { events.push("watch"); },
    repositoryRoot: () => "/repo",
    ensureUntracked: async (candidate) => { events.push(["untracked", candidate]); },
    scheduleTracked: (candidate) => { events.push(["tracked", candidate]); },
  });
  assert.deepEqual(events, ["files", "watch", ["untracked", identity], ["tracked", identity]]);
});

test("task reconciliation rejects stale workspaces before each mutation stage", async () => {
  let current = true;
  const events = [];
  await reconcileAfterSuccessfulTask(identity, {
    matches: () => current,
    filesRoot: () => "/repo",
    refreshFiles: async () => { events.push("files"); current = false; },
    activateWatch: () => { events.push("watch"); },
    repositoryRoot: () => "/repo",
    ensureUntracked: async () => { events.push("untracked"); },
    scheduleTracked: () => { events.push("tracked"); },
  });
  assert.deepEqual(events, ["files"]);
});

test("non-Git workspaces refresh files without inventing repository work", async () => {
  const events = [];
  await reconcileAfterSuccessfulTask(identity, {
    matches: () => true,
    filesRoot: () => "/repo",
    refreshFiles: async () => { events.push("files"); },
    activateWatch: () => { events.push("watch"); },
    repositoryRoot: () => null,
    ensureUntracked: async () => { events.push("untracked"); },
    scheduleTracked: () => { events.push("tracked"); },
  });
  assert.deepEqual(events, ["files", "watch"]);
});
