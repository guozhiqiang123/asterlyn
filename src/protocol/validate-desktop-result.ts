import type {
  DesktopCommandMap,
  DesktopCommandName,
} from "./generated-desktop-protocol";
import { DESKTOP_RESULT_VALIDATORS } from "./generated-desktop-protocol.ts";
import { assertCommitFilePreview } from "./validate-commit-file-preview.ts";
import { assertCommitFileComparison } from "./validate-commit-file-comparison.ts";
import { assertCommitFileRestorePreview, assertFileRestoreApplyResult, assertFileRestoreRecoveryList } from "./validate-file-restore.ts";
import {
  arrays, assert, booleans, isRecord, nullableStrings, numbers, record, strings,
  type TransportRecord,
} from "./desktop-result-validation-primitives.ts";

export function validateDesktopResult<Command extends DesktopCommandName>(
  command: Command,
  value: unknown,
): DesktopCommandMap[Command]["result"] {
  const validator = DESKTOP_RESULT_VALIDATORS[command];
  switch (validator) {
    case "void":
      assert(value === null || value === undefined, command, "expected no response body");
      break;
    case "boolean":
      assert(typeof value === "boolean", command, "expected a boolean");
      break;
    case "string":
      assert(typeof value === "string", command, "expected a string");
      break;
    case "nullableString":
      assert(value === null || typeof value === "string", command, "expected a string or null");
      break;
    case "stringArray":
      assert(isStringArray(value), command, "expected an array of strings");
      break;
    case "windowChromeMode":
      assert(
        value === "macos-native" || value === "custom-right",
        command,
        "expected a supported window chrome mode",
      );
      break;
    case "workspaceWatchStatus": {
      const result = record(value, command);
      booleans(result, command, "available", "verificationRequired");
      nullableStrings(result, command, "message");
      assert(
        result.watchInstance === null ||
          (typeof result.watchInstance === "number" &&
            Number.isSafeInteger(result.watchInstance) && result.watchInstance > 0),
        command,
        "watchInstance must be a positive integer or null",
      );
      assert(
        result.available === (result.watchInstance !== null),
        command,
        "available and watchInstance must describe the same watcher state",
      );
      assert(
        !result.verificationRequired || result.available === true,
        command,
        "verification requires an available watcher",
      );
      break;
    }
    case "terminalStarted": {
      const result = record(value, command);
      numbers(result, command, "protocolVersion");
      strings(result, command, "sessionId", "shell", "cwd");
      assert(result.protocolVersion === 1, command, "expected terminal protocol version 1");
      assert(Boolean(result.sessionId), command, "terminal session ID must not be empty");
      break;
    }
    case "openedProject": {
      const result = record(value, command);
      strings(result, command, "root");
      assert(
        result.repository === null || isRepositorySnapshot(result.repository),
        command,
        "repository must be a snapshot or null",
      );
      break;
    }
    case "projectWindowMatch":
      assert(
        value === "notOpen" || value === "current" || value === "focusedExisting",
        command,
        "expected a supported project-window match",
      );
      break;
    case "projectWindowOpenResult": {
      const result = record(value, command);
      strings(result, command, "windowLabel");
      booleans(result, command, "focusedExisting");
      assert(Boolean(result.windowLabel), command, "window label must not be empty");
      break;
    }
    case "repositorySliceProject": {
      const result = record(value, command);
      strings(result, command, "root");
      assert(
        result.repository === null || isRepositorySliceSnapshot(result.repository),
        command,
        "repository must be a slice snapshot or null",
      );
      break;
    }
    case "repositorySnapshot":
      assert(isRepositorySnapshot(value), command, "expected a repository snapshot");
      break;
    case "nullableGitOperationSnapshot":
      assert(
        value === null || isGitOperationSnapshot(value),
        command,
        "expected a Git operation snapshot or null",
      );
      break;
    case "gitOperationPlan": {
      const result = record(value, command);
      strings(
        result,
        command,
        "kind",
        "repositoryRoot",
        "startHeadOid",
        "startHeadRef",
        "summary",
        "previewToken",
      );
      arrays(result, command, "targetRefs", "targetOids");
      numbers(result, command, "commitCount");
      nullableStrings(result, command, "message");
      assertGitOperationKind(result.kind, command);
      assertStringArray(result.targetRefs, command, "targetRefs");
      assertStringArray(result.targetOids, command, "targetOids");
      break;
    }
    case "branchMutationPlan": {
      const result = record(value, command);
      strings(
        result,
        command,
        "repositoryRoot",
        "kind",
        "sourceFullName",
        "sourceOid",
        "sourceKind",
        "sourceName",
        "startHeadRef",
        "startHeadOid",
        "previewToken",
      );
      nullableStrings(result, command, "targetFullName", "newName", "upstream");
      assert(typeof result.deleteRemote === "boolean", command, "deleteRemote must be a boolean");
      if (result.remoteDeletion !== null) {
        const remoteDeletion = record(result.remoteDeletion, command);
        strings(remoteDeletion, command, "remote", "branchFullName", "trackingFullName", "oid");
      }
      assert(
        ["switch", "create", "checkoutRemote", "rename", "delete"].includes(String(result.kind)),
        command,
        "kind must be a supported branch mutation kind",
      );
      assert(
        ["local", "remote", "commit"].includes(String(result.sourceKind)),
        command,
        "sourceKind must be local, remote, or commit",
      );
      assert(
        result.mergedIntoCurrent === null || typeof result.mergedIntoCurrent === "boolean",
        command,
        "mergedIntoCurrent must be boolean or null",
      );
      break;
    }
    case "gitConflictContent": {
      const result = record(value, command);
      strings(result, command, "path", "revisionToken");
      nullableStrings(result, command, "base", "ours", "theirs", "worktree");
      booleans(result, command, "binary");
      break;
    }
    case "repositoryMutationOutcome": {
      const result = record(value, command);
      assert(isRepositorySnapshot(result.snapshot), command, "expected a mutation snapshot");
      assertRepositorySlices(result.invalidatedSlices, command);
      break;
    }
    case "remoteAuthenticationStatus": {
      const result = record(value, command);
      strings(result, command, "remote", "transport");
      nullableStrings(result, command, "host", "suggestedSshUrl");
      booleans(
        result,
        command,
        "credentialAvailable",
        "credentialHelperConfigured",
      );
      assert(
        result.transport === "https" ||
          result.transport === "ssh" ||
          result.transport === "local" ||
          result.transport === "other",
        command,
        "transport must be a supported remote transport",
      );
      break;
    }
    case "workingTreeMutationOutcome": {
      const result = record(value, command);
      assertTrackedChangeScan(result.tracked, command);
      assertRepositorySlices(result.invalidatedSlices, command);
      break;
    }
    case "restoreChangesPlan": {
      const result = record(value, command);
      strings(result, command, "root", "headOid", "token");
      assert(isStringArray(result.paths), command, "expected exact restore paths");
      arrays(result, command, "selected");
      break;
    }
    case "gitWorktreeRecoveries": {
      assert(Array.isArray(value), command, "expected a worktree recovery list");
      for (const entry of value as unknown[]) {
        const result = record(entry, command);
        strings(result, command, "id", "operation", "status", "backupPath");
        booleans(result, command, "canUndo");
        assert(isStringArray(result.paths), command, "expected recovery paths");
      }
      break;
    }
    case "gitOperationMutationOutcome": {
      const result = record(value, command);
      assertTrackedChangeScan(result.tracked, command);
      assert(
        result.operation === null || isGitOperationSnapshot(result.operation),
        command,
        "expected a nullable Git operation snapshot",
      );
      assertRepositorySlices(result.invalidatedSlices, command);
      break;
    }
    case "trackedChangeScan":
    case "untrackedScan": {
      assertTrackedChangeScan(value, command);
      break;
    }
    case "historyPage": {
      const result = record(value, command);
      arrays(result, command, "commits");
      numbers(result, command, "offset");
      booleans(result, command, "hasMore");
      break;
    }
    case "diffResult": {
      const result = record(value, command);
      strings(result, command, "path", "patch");
      booleans(result, command, "staged", "binary", "truncated");
      break;
    }
    case "imagePreview":
      assertImagePreview(value, command);
      break;
    case "imageDiffPreview": {
      const result = record(value, command);
      strings(result, command, "path");
      for (const side of ["before", "after"] as const) {
        assert(
          result[side] === null || isImagePreview(result[side]),
          command,
          `${side} must be an image preview or null`,
        );
      }
      break;
    }
    case "projectFileList": {
      const result = record(value, command);
      strings(result, command, "root");
      arrays(result, command, "paths", "files", "ignoredEntries", "repositoryRoots");
      booleans(result, command, "truncated");
      break;
    }
    case "workspaceRevealResult": {
      const result = record(value, command);
      booleans(result, command, "selected");
      break;
    }
    case "workspaceEntryInspection": {
      const result = record(value, command);
      numbers(result, command, "entryCount", "totalBytes", "hiddenEntryCount");
      arrays(
        result,
        command,
        "symlinkPaths",
        "nestedRepositoryPaths",
        "multipleLinkPaths",
      );
      strings(result, command, "fingerprint");
      booleans(result, command, "truncated");
      assert(isWorkspaceEntryIdentity(result.source), command, "source must be an entry identity");
      assertNonNegativeInteger(result.entryCount, command, "entryCount");
      assertNonNegativeInteger(result.totalBytes, command, "totalBytes");
      assertNonNegativeInteger(result.hiddenEntryCount, command, "hiddenEntryCount");
      assertStringArray(result.symlinkPaths, command, "symlinkPaths");
      assertStringArray(result.nestedRepositoryPaths, command, "nestedRepositoryPaths");
      assertStringArray(result.multipleLinkPaths, command, "multipleLinkPaths");
      assert(Boolean(result.fingerprint), command, "fingerprint must not be empty");
      break;
    }
    case "workspaceMutationPreview": {
      const result = record(value, command);
      strings(result, command, "planId", "collisionPolicy");
      nullableStrings(result, command, "fingerprint");
      numbers(result, command, "entryCount", "totalBytes", "hiddenEntryCount");
      arrays(result, command, "blockers");
      assertWorkspaceMutationOperation(result.operation, command);
      assert(
        result.collisionPolicy === "cancel" || result.collisionPolicy === "renameTarget",
        command,
        "collisionPolicy must be supported",
      );
      assertNonNegativeInteger(result.entryCount, command, "entryCount");
      assertNonNegativeInteger(result.totalBytes, command, "totalBytes");
      assertNonNegativeInteger(result.hiddenEntryCount, command, "hiddenEntryCount");
      assert(
        result.source === null || isWorkspaceEntryIdentity(result.source),
        command,
        "source must be an entry identity or null",
      );
      for (const blocker of result.blockers as unknown[]) {
        assertWorkspaceMutationBlocker(blocker, command);
      }
      break;
    }
    case "workspaceMutationOutcome": {
      const result = record(value, command);
      strings(result, command, "planId", "status");
      arrays(result, command, "affectedPaths", "pathRemaps", "invalidatedSlices");
      nullableStrings(result, command, "recoveryId", "error");
      assert(
        [
          "completed",
          "noOp",
          "cancelledBeforeWrite",
          "failedWithoutChange",
          "failedWithRecovery",
          "uncertain",
        ].includes(result.status as string),
        command,
        "status must be a supported workspace mutation status",
      );
      assertStringArray(result.affectedPaths, command, "affectedPaths");
      for (const remap of result.pathRemaps as unknown[]) {
        const item = record(remap, command);
        strings(item, command, "source", "destination");
      }
      assert(
        (result.invalidatedSlices as unknown[]).every((slice) =>
          slice === "workspaceCatalog" || slice === "openDocuments" || slice === "workingTree"
        ),
        command,
        "invalidatedSlices contains an unsupported workspace slice",
      );
      break;
    }
    case "workspaceMutationRecoveryList":
      assert(Array.isArray(value), command, "expected a workspace mutation recovery list");
      for (const recovery of value as unknown[]) {
        const result = record(recovery, command);
        strings(result, command, "recoveryId", "workspaceRoot", "phase");
        nullableStrings(result, command, "destination", "sourceHold");
        assertWorkspaceMutationOperation(result.operation, command);
      }
      break;
    case "workspaceTextSearchReport": {
      const result = record(value, command);
      strings(result, command, "requestId");
      arrays(result, command, "matches", "skippedFiles", "coverageReasons");
      numbers(
        result,
        command,
        "catalogCandidates",
        "eligibleCandidates",
        "filesSearched",
        "bytesRead",
        "skippedCount",
      );
      break;
    }
    case "workspaceReplacementPreview": {
      const result = record(value, command);
      strings(result, command, "planId");
      arrays(result, command, "files", "coverageReasons");
      numbers(result, command, "totalMatches", "skippedCount");
      break;
    }
    case "replacementApplyResult":
      assertReplacementRecovery(value, command, true);
      break;
    case "replacementRecoveryList":
      assert(Array.isArray(value), command, "expected a replacement recovery list");
      for (const recovery of value as unknown[]) assertReplacementRecovery(recovery, command, false);
      break;
    case "textFileSnapshot": {
      const result = record(value, command);
      strings(result, command, "workspacePath", "content", "revision");
      booleans(result, command, "utf8Bom");
      numbers(result, command, "byteLength");
      break;
    }
    case "saveTextFileResult": {
      const result = record(value, command);
      strings(result, command, "workspacePath", "revision", "requestId");
      numbers(result, command, "byteLength");
      booleans(result, command, "alreadySaved");
      break;
    }
    case "commitDetails":
      assertCommitDetails(value, command);
      break;
    case "commitComparisonDetails": {
      const result = record(value, command);
      strings(result, command, "repositoryId", "beforeOid", "afterOid", "relation");
      arrays(result, command, "files");
      assert(
        ["beforeIsAncestor", "afterIsAncestor", "divergent"].includes(
          result.relation as string,
        ),
        command,
        "relation must be a supported commit-comparison relation",
      );
      break;
    }
    case "gitBlameResult": {
      const result = record(value, command);
      strings(result, command, "repositoryId", "path");
      nullableStrings(result, command, "revision");
      arrays(result, command, "hunks");
      booleans(result, command, "truncated");
      for (const value of result.hunks as unknown[]) {
        const hunk = record(value, command);
        strings(hunk, command, "oid", "authorName", "authorEmail", "summary");
        numbers(hunk, command, "originalStartLine", "finalStartLine", "lineCount", "authoredAt");
        booleans(hunk, command, "uncommitted");
        const originalStartLine = hunk.originalStartLine as number;
        const finalStartLine = hunk.finalStartLine as number;
        const lineCount = hunk.lineCount as number;
        assert(
          Number.isSafeInteger(originalStartLine) && originalStartLine > 0 &&
            Number.isSafeInteger(finalStartLine) && finalStartLine > 0 &&
            Number.isSafeInteger(lineCount) && lineCount > 0,
          command,
          "blame line ranges must contain positive integers",
        );
      }
      break;
    }
    case "nullableCommitDetails":
      if (value !== null) assertCommitDetails(value, command);
      break;
    case "commitDiffResult": {
      const result = record(value, command);
      strings(result, command, "repositoryId", "oid", "path", "patch");
      booleans(result, command, "binary", "truncated");
      break;
    }
    case "commitFilePreview": {
      assertCommitFilePreview(value, command);
      break;
    }
    case "commitFileComparison": {
      assertCommitFileComparison(value, command);
      break;
    }
    case "commitFileRestorePreview":
      assertCommitFileRestorePreview(value, command); break;
    case "fileRestoreApplyResult":
      assertFileRestoreApplyResult(value, command); break;
    case "fileRestoreRecoveryList":
      assertFileRestoreRecoveryList(value, command); break;
    case "commitComparisonDiffResult": {
      const result = record(value, command);
      strings(result, command, "repositoryId", "beforeOid", "afterOid", "path", "patch");
      booleans(result, command, "binary", "truncated");
      break;
    }
    case "commitSelectedResult": {
      const result = record(value, command);
      nullableStrings(result, command, "oid", "refreshError", "verificationWarning");
      assertRepositorySlices(result.invalidatedSlices, command);
      assert(
        result.snapshot === null || isRepositorySnapshot(result.snapshot),
        command,
        "snapshot must be a repository snapshot or null",
      );
      break;
    }
    case "pushPreview": {
      const result = record(value, command);
      strings(
        result,
        command,
        "remote",
        "branch",
        "sourceRef",
        "destinationRef",
        "headOid",
        "tagMode",
        "previewToken",
      );
      nullableStrings(
        result,
        command,
        "comparisonBaseOid",
        "ordinaryBlockReason",
        "forceWithLeaseBlockReason",
      );
      arrays(result, command, "tags", "files", "commits");
      numbers(result, command, "offset", "totalCommits");
      booleans(
        result,
        command,
        "publish",
        "ordinaryAllowed",
        "forceWithLeaseAllowed",
        "filesTruncated",
        "hasMore",
        "truncated",
      );
      break;
    }
    default:
      throw new Error(`No desktop response validator is registered for ${command}.`);
  }
  return value as DesktopCommandMap[Command]["result"];
}

function assertTrackedChangeScan(value: unknown, command: DesktopCommandName): void {
  const result = record(value, command);
  strings(result, command, "root");
  arrays(result, command, "changes");
}

function assertRepositorySlices(value: unknown, command: DesktopCommandName): void {
  const known = new Set([
    "workspaceCatalog",
    "openDocuments",
    "repositoryCapability",
    "workingTree",
    "head",
    "refs",
    "history",
    "operation",
  ]);
  assert(
    Array.isArray(value) && value.every((slice) => typeof slice === "string" && known.has(slice)),
    command,
    "invalidatedSlices contains an unknown repository slice",
  );
}

function isRepositorySnapshot(value: unknown): value is TransportRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.root === "string" &&
    typeof value.gitDir === "string" &&
    isRecord(value.branch) &&
    Array.isArray(value.repositoryRoots) &&
    Array.isArray(value.changes) &&
    Array.isArray(value.commits) &&
    Array.isArray(value.branches) &&
    Array.isArray(value.remotes) &&
    typeof value.untrackedState === "string" &&
    (value.operation === null || isGitOperationSnapshot(value.operation))
  );
}

function isRepositorySliceSnapshot(value: unknown): value is TransportRecord {
  if (!isRecord(value)) return false;
  if (typeof value.root !== "string" || typeof value.gitDir !== "string") return false;
  for (const field of ["repositoryRoots", "changes", "commits", "branches", "remotes"] as const) {
    if (field in value && !Array.isArray(value[field])) return false;
  }
  if ("branch" in value && !isRecord(value.branch)) return false;
  if (
    "operation" in value &&
    value.operation !== null &&
    !isGitOperationSnapshot(value.operation)
  ) return false;
  return !("untrackedState" in value) ||
    value.untrackedState === "pending" ||
    value.untrackedState === "complete" ||
    value.untrackedState === "failed";
}

function isGitOperationSnapshot(value: unknown): value is TransportRecord {
  if (!isRecord(value)) return false;
  if (!isGitOperationKind(value.kind)) return false;
  if (value.phase !== "conflicted" && value.phase !== "paused") return false;
  if (!isStringArray(value.targetOids) || !Array.isArray(value.conflicts)) return false;
  if (!value.conflicts.every((conflict) =>
    isRecord(conflict) &&
    typeof conflict.path === "string" &&
    ["baseOid", "oursOid", "theirsOid"].every(
      (key) => conflict[key] === null || typeof conflict[key] === "string",
    )
  )) return false;
  if (!Array.isArray(value.allowedActions)) return false;
  if (!value.allowedActions.every((action) => ["continue", "skip", "abort"].includes(String(action)))) {
    return false;
  }
  const progress = value.progress;
  if (
    !isRecord(progress) ||
    !["current", "total"].every(
      (key) => progress[key] === null || typeof progress[key] === "number",
    ) ||
    !(progress.detail === null || typeof progress.detail === "string")
  ) return false;
  return ["originalHeadOid", "currentHeadOid", "headRef"].every(
    (key) => value[key] === null || typeof value[key] === "string",
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function assertStringArray(
  value: unknown,
  command: DesktopCommandName,
  field: string,
): void {
  assert(isStringArray(value), command, `${field} must contain only strings`);
}

function isGitOperationKind(value: unknown): boolean {
  return ["merge", "cherryPick", "rebase", "squash", "revert", "bisect"].includes(String(value));
}

function assertGitOperationKind(value: unknown, command: DesktopCommandName): void {
  assert(isGitOperationKind(value), command, "kind must be a supported Git operation kind");
}

function isImagePreview(value: unknown): value is TransportRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.path === "string" &&
    typeof value.mediaType === "string" &&
    typeof value.dataUrl === "string" &&
    typeof value.width === "number" &&
    typeof value.height === "number" &&
    typeof value.byteLength === "number"
  );
}

function assertImagePreview(value: unknown, command: DesktopCommandName): void {
  assert(isImagePreview(value), command, "expected an image preview");
}

function assertCommitDetails(value: unknown, command: DesktopCommandName): void {
  const result = record(value, command);
  strings(result, command, "repositoryId", "oid");
  nullableStrings(result, command, "parentOid");
  arrays(result, command, "files");
}

function assertReplacementRecovery(
  value: unknown,
  command: DesktopCommandName,
  withMessage: boolean,
): void {
  const result = record(value, command);
  strings(result, command, "recoveryId", "status");
  arrays(result, command, "files");
  if (withMessage) nullableStrings(result, command, "message");
}

function assertWorkspaceMutationOperation(
  value: unknown,
  command: DesktopCommandName,
): void {
  const operation = record(value, command);
  strings(operation, command, "kind");
  switch (operation.kind) {
    case "createFile":
      strings(operation, command, "destination");
      break;
    case "copy":
    case "move":
      strings(operation, command, "source", "destination");
      break;
    case "trash":
      strings(operation, command, "source");
      break;
    default:
      assert(false, command, "operation kind must be supported");
  }
}

function isWorkspaceEntryIdentity(value: unknown): value is TransportRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.workspacePath === "string" &&
    (value.kind === "file" || value.kind === "directory") &&
    typeof value.revision === "string" &&
    typeof value.mode === "number" &&
    Number.isSafeInteger(value.mode) &&
    value.mode >= 0 &&
    typeof value.byteLength === "number" &&
    Number.isSafeInteger(value.byteLength) &&
    value.byteLength >= 0
  );
}

function assertWorkspaceMutationBlocker(
  value: unknown,
  command: DesktopCommandName,
): void {
  const blocker = record(value, command);
  strings(blocker, command, "kind");
  switch (blocker.kind) {
    case "destinationExists":
    case "destinationInsideSource":
      strings(blocker, command, "path");
      break;
    case "symlink":
    case "nestedRepository":
    case "multipleHardLinks":
      assertStringArray(blocker.paths, command, "paths");
      break;
    case "inventoryTruncated":
      break;
    default:
      assert(false, command, "blocker kind must be supported");
  }
}

function assertNonNegativeInteger(
  value: unknown,
  command: DesktopCommandName,
  name: string,
): void {
  assert(
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
    command,
    `${name} must be a non-negative integer`,
  );
}
