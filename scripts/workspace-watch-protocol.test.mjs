import assert from "node:assert/strict";
import test from "node:test";

import { parseWorkspaceWatchInvalidation } from "../src/protocol/workspace-watch.ts";

test("workspace-watch protocol accepts a typed native hint", () => {
  const event = {
    root: "/repo",
    generation: 7,
    slices: ["openDocuments", "workingTree"],
    paths: ["src/app.ts"],
    causes: ["watcher"],
    overflowed: false,
  };

  assert.deepEqual(parseWorkspaceWatchInvalidation(event), event);
});

test("workspace-watch protocol rejects unknown slices and causes", () => {
  const event = {
    root: "/repo",
    generation: 7,
    slices: ["workingTree"],
    paths: [],
    causes: ["watcher"],
    overflowed: false,
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
