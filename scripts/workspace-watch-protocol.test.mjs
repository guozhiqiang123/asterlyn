import assert from "node:assert/strict";
import test from "node:test";

import { parseWorkspaceWatchInvalidation } from "../src/protocol/workspace-watch.ts";

test("workspace-watch protocol accepts a typed native hint", () => {
  const event = {
    root: "/repo",
    generation: 7,
    watchInstance: 3,
    slices: ["openDocuments", "workingTree"],
    paths: ["src/app.ts"],
    causes: ["watcher"],
    recovery: "none",
  };

  assert.deepEqual(parseWorkspaceWatchInvalidation(event), event);
});

test("workspace-watch protocol rejects unknown slices and causes", () => {
  const event = {
    root: "/repo",
    generation: 7,
    watchInstance: 3,
    slices: ["workingTree"],
    paths: [],
    causes: ["watcher"],
    recovery: "none",
  };

  assert.throws(
    () => parseWorkspaceWatchInvalidation({ ...event, slices: ["everything"] }),
    /invalid state slice/,
  );
  assert.throws(
    () => parseWorkspaceWatchInvalidation({ ...event, causes: ["untrusted"] }),
    /invalid cause/,
  );
  assert.throws(
    () => parseWorkspaceWatchInvalidation({ ...event, generation: 1.5 }),
    /invalid generation/,
  );
});

test("workspace-watch protocol rejects empty, duplicate, escaping, and inconsistent recovery payloads", () => {
  const event = {
    root: "/repo",
    generation: 7,
    watchInstance: 3,
    slices: ["workingTree"],
    paths: [],
    causes: ["watcher"],
    recovery: "none",
  };

  assert.throws(() => parseWorkspaceWatchInvalidation({ ...event, slices: [] }), /no state slices/);
  assert.throws(
    () => parseWorkspaceWatchInvalidation({ ...event, slices: ["workingTree", "workingTree"] }),
    /duplicate state slices/,
  );
  for (const path of ["../outside", "/absolute", "C:/absolute", "nested\\escape"]) {
    assert.throws(
      () => parseWorkspaceWatchInvalidation({ ...event, paths: [path] }),
      /invalid workspace path/,
    );
  }
  assert.throws(
    () => parseWorkspaceWatchInvalidation({
      ...event,
      recovery: "backendOverflow",
      causes: ["overflowRecovery"],
    }),
    /complete recovery/,
  );
  assert.throws(
    () => parseWorkspaceWatchInvalidation({
      ...event,
      recovery: "pathsTruncated",
      paths: ["src/app.ts"],
    }),
    /cannot claim exact paths/,
  );
});
