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
  assert.equal(
    validateDesktopResult("focus_existing_project_window", "focusedExisting"),
    "focusedExisting",
  );
  assert.deepEqual(
    validateDesktopResult("open_repository_window", {
      windowLabel: "project-1",
      focusedExisting: true,
    }),
    { windowLabel: "project-1", focusedExisting: true },
  );
  assert.equal(validateDesktopResult("window_chrome_mode", "macos-native"), "macos-native");
  assert.deepEqual(
    validateDesktopResult("read_repository_slices", {
      root: "/repo",
      repository: {
        root: "/repo",
        gitDir: "/repo/.git",
        branches: [],
        remotes: [],
        repositoryRoots: [],
      },
    }),
    {
      root: "/repo",
      repository: {
        root: "/repo",
        gitDir: "/repo/.git",
        branches: [],
        remotes: [],
        repositoryRoots: [],
      },
    },
  );
  assert.deepEqual(
    validateDesktopResult("existing_project_directories", ["/repo", "/workspace"]),
    ["/repo", "/workspace"],
  );
  assert.deepEqual(
    validateDesktopResult("start_workspace_watch", {
      available: true,
      message: null,
      watchInstance: 4,
      verificationRequired: false,
    }),
    { available: true, message: null, watchInstance: 4, verificationRequired: false },
  );
  assert.deepEqual(
    validateDesktopResult("start_terminal", {
      protocolVersion: 1,
      sessionId: "terminal-1",
      shell: "bash",
      cwd: "/repo",
    }),
    { protocolVersion: 1, sessionId: "terminal-1", shell: "bash", cwd: "/repo" },
  );
  assert.equal(validateDesktopResult("close_terminal", true), true);
  assert.equal(validateDesktopResult("cancel_remote_operation", null), null);
  assert.deepEqual(
    validateDesktopResult("read_remote_authentication", {
      remote: "origin",
      transport: "https",
      host: "github.com",
      credentialAvailable: false,
      credentialHelperConfigured: true,
      suggestedSshUrl: "git@github.com:owner/repository.git",
    }),
    {
      remote: "origin",
      transport: "https",
      host: "github.com",
      credentialAvailable: false,
      credentialHelperConfigured: true,
      suggestedSshUrl: "git@github.com:owner/repository.git",
    },
  );
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
    () => validateDesktopResult("start_workspace_watch", {
      available: "yes",
      message: null,
      watchInstance: null,
      verificationRequired: false,
    }),
    /available must be a boolean/,
  );
});

test("desktop response validation rejects malformed project-directory results", () => {
  assert.throws(
    () => validateDesktopResult("existing_project_directories", ["/repo", 7]),
    /array of strings/,
  );
});

test("desktop response validation rejects malformed project-window routing results", () => {
  assert.throws(
    () => validateDesktopResult("focus_existing_project_window", "anotherWindow"),
    /supported project-window match/,
  );
  assert.throws(
    () => validateDesktopResult("open_repository_window", {
      windowLabel: "",
      focusedExisting: false,
    }),
    /window label must not be empty/,
  );
});

test("desktop response validation rejects unknown remote transports", () => {
  assert.throws(
    () => validateDesktopResult("read_remote_authentication", {
      remote: "origin",
      transport: "password",
      host: "github.com",
      credentialAvailable: false,
      credentialHelperConfigured: true,
      suggestedSshUrl: null,
    }),
    /supported remote transport/,
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
