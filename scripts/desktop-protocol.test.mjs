import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { generateDesktopProtocol } from "./generate-desktop-protocol.mjs";
import { validateDesktopResult } from "../src/protocol/validate-desktop-result.ts";

test("generated desktop command types match the versioned protocol schema", async () => {
  const generated = await readFile(
    new URL("../src/protocol/generated-desktop-protocol.ts", import.meta.url),
    "utf8",
  );
  assert.equal(generated, await generateDesktopProtocol());
});

test("desktop response validation rejects malformed command payloads", () => {
  assert.throws(
    () => validateDesktopResult("open_project", { root: "/repo" }),
    /repository must be a snapshot or null/,
  );
  assert.throws(
    () => validateDesktopResult("read_history_page", { commits: [], offset: "0", hasMore: false }),
    /offset must be a number/,
  );
});

test("desktop response validation accepts representative valid payloads", () => {
  assert.deepEqual(
    validateDesktopResult("open_project", { root: "/repo", repository: null }),
    { root: "/repo", repository: null },
  );
  assert.equal(validateDesktopResult("window_chrome_mode", "macos-native"), "macos-native");
  assert.deepEqual(
    validateDesktopResult("start_workspace_watch", { available: true, message: null }),
    { available: true, message: null },
  );
  assert.equal(validateDesktopResult("cancel_remote_operation", null), null);
  assert.deepEqual(
    validateDesktopResult("resolve_conflict", {
      tracked: { root: "/repo", changes: [] },
      operation: null,
      invalidatedSlices: ["openDocuments", "workingTree", "operation"],
    }),
    {
      tracked: { root: "/repo", changes: [] },
      operation: null,
      invalidatedSlices: ["openDocuments", "workingTree", "operation"],
    },
  );
});

test("desktop response validation rejects malformed watch status", () => {
  assert.throws(
    () => validateDesktopResult("start_workspace_watch", { available: "yes", message: null }),
    /available must be a boolean/,
  );
});

test("desktop response validation rejects unknown mutation slices", () => {
  assert.throws(
    () => validateDesktopResult("stage_paths", {
      tracked: { root: "/repo", changes: [] },
      invalidatedSlices: ["everything"],
    }),
    /unknown repository slice/,
  );
});

function repositorySnapshot() {
  return {
    root: "/repo",
    gitDir: "/repo/.git",
    repositoryRoots: [],
    branch: {},
    operation: null,
    changes: [],
    commits: [],
    branches: [],
    remotes: [],
    untrackedState: "complete",
  };
}
