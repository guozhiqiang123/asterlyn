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
    validateDesktopResult("reveal_workspace_entry", { selected: false }),
    { selected: false },
  );
  const inspection = {
    source: {
      workspacePath: "src",
      kind: "directory",
      revision: "revision",
      mode: 493,
      byteLength: 12,
    },
    entryCount: 3,
    totalBytes: 12,
    hiddenEntryCount: 1,
    symlinkPaths: [],
    nestedRepositoryPaths: [],
    multipleLinkPaths: [],
    truncated: false,
    fingerprint: "a".repeat(64),
  };
  assert.deepEqual(validateDesktopResult("inspect_workspace_entry", inspection), inspection);
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
    validateDesktopResult("read_commit_comparison_details", {
      repositoryId: ".",
      beforeOid: "1".repeat(40),
      afterOid: "2".repeat(40),
      files: [],
    }),
    {
      repositoryId: ".",
      beforeOid: "1".repeat(40),
      afterOid: "2".repeat(40),
      files: [],
    },
  );
  assert.deepEqual(
    validateDesktopResult("read_commit_comparison_diff", {
      repositoryId: ".",
      beforeOid: "1".repeat(40),
      afterOid: "2".repeat(40),
      path: "src/app.ts",
      patch: "diff --git a/src/app.ts b/src/app.ts\n",
      binary: false,
      truncated: false,
    }).path,
    "src/app.ts",
  );
  assert.deepEqual(
    validateDesktopResult("read_git_blame", {
      repositoryId: ".",
      path: "src/app.ts",
      revision: null,
      hunks: [{
        oid: "0".repeat(40),
        originalStartLine: 1,
        finalStartLine: 1,
        lineCount: 2,
        authorName: "Not Committed Yet",
        authorEmail: "",
        authoredAt: 0,
        summary: "local changes",
        uncommitted: true,
      }],
      truncated: false,
    }).hunks[0].lineCount,
    2,
  );
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
  const branchPlan = {
    repositoryRoot: "/repo",
    kind: "rename",
    sourceFullName: "refs/heads/old",
    sourceOid: "a".repeat(40),
    sourceKind: "local",
    sourceName: "old",
    targetFullName: "refs/heads/new",
    newName: "new",
    startHeadRef: "refs/heads/main",
    startHeadOid: "b".repeat(40),
    upstream: "origin/old",
    mergedIntoCurrent: null,
    previewToken: "reviewed-plan",
  };
  assert.deepEqual(validateDesktopResult("prepare_branch_mutation", branchPlan), branchPlan);
});

test("desktop response validation rejects malformed results", () => {
  assert.throws(
    () => validateDesktopResult("read_git_blame", {
      repositoryId: ".",
      path: "src/app.ts",
      revision: null,
      hunks: [{
        oid: "0".repeat(40),
        originalStartLine: 0,
        finalStartLine: 1,
        lineCount: 1,
        authorName: "Local",
        authorEmail: "",
        authoredAt: 0,
        summary: "local changes",
        uncommitted: true,
      }],
      truncated: false,
    }),
    /positive integers/,
  );
  assert.throws(
    () => validateDesktopResult("start_workspace_watch", {
      available: "yes",
      message: null,
      watchInstance: null,
      verificationRequired: false,
    }),
    /available must be a boolean/,
  );
  assert.throws(
    () => validateDesktopResult("prepare_branch_mutation", {
      repositoryRoot: "/repo", kind: "forceDelete", sourceFullName: "refs/heads/topic",
      sourceOid: "a".repeat(40), sourceKind: "local", sourceName: "topic",
      targetFullName: null, newName: null, startHeadRef: "refs/heads/main",
      startHeadOid: "b".repeat(40), upstream: null, mergedIntoCurrent: true,
      previewToken: "reviewed-plan",
    }),
    /supported branch mutation kind/,
  );
});

test("desktop response validation rejects malformed project-directory results", () => {
  assert.throws(
    () => validateDesktopResult("existing_project_directories", ["/repo", 7]),
    /array of strings/,
  );
  assert.throws(
    () => validateDesktopResult("reveal_workspace_entry", { selected: "no" }),
    /selected must be a boolean/,
  );
  assert.throws(
    () => validateDesktopResult("inspect_workspace_entry", {
      source: null,
      entryCount: 1,
      totalBytes: 1,
      hiddenEntryCount: 0,
      symlinkPaths: [],
      nestedRepositoryPaths: [],
      multipleLinkPaths: [],
      truncated: false,
      fingerprint: "revision",
    }),
    /source must be an entry identity/,
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

test("desktop response validation checks workspace mutation plans and outcomes", () => {
  const preview = {
    planId: "move-1",
    operation: { kind: "move", source: "old", destination: "new" },
    collisionPolicy: "cancel",
    source: {
      workspacePath: "old",
      kind: "directory",
      revision: "revision",
      mode: 493,
      byteLength: 12,
    },
    entryCount: 3,
    totalBytes: 12,
    hiddenEntryCount: 1,
    fingerprint: "a".repeat(64),
    blockers: [],
  };
  assert.deepEqual(validateDesktopResult("plan_workspace_mutation", preview), preview);

  const outcome = {
    planId: "move-1",
    status: "completed",
    affectedPaths: ["old", "new"],
    pathRemaps: [{ source: "old", destination: "new" }],
    invalidatedSlices: ["workspaceCatalog", "openDocuments", "workingTree"],
    recoveryId: null,
    error: null,
  };
  assert.deepEqual(validateDesktopResult("execute_workspace_mutation", outcome), outcome);

  assert.throws(
    () => validateDesktopResult("plan_workspace_mutation", {
      ...preview,
      blockers: [{ kind: "symlink", paths: ["valid", 7] }],
    }),
    /paths must contain only strings/,
  );
  assert.throws(
    () => validateDesktopResult("execute_workspace_mutation", {
      ...outcome,
      invalidatedSlices: ["history"],
    }),
    /unsupported workspace slice/,
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
