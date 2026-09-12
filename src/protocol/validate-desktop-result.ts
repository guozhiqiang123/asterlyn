import type {
  DesktopCommandMap,
  DesktopCommandName,
} from "./generated-desktop-protocol";
import { DESKTOP_RESULT_VALIDATORS } from "./generated-desktop-protocol.ts";

type TransportRecord = Record<string, unknown>;

export function validateDesktopResult<Command extends DesktopCommandName>(
  command: Command,
  value: unknown,
): DesktopCommandMap[Command]["result"] {
  const validator = DESKTOP_RESULT_VALIDATORS[command];
  switch (validator) {
    case "void":
      assert(value === null || value === undefined, command, "expected no response body");
      break;
    case "string":
      assert(typeof value === "string", command, "expected a string");
      break;
    case "nullableString":
      assert(value === null || typeof value === "string", command, "expected a string or null");
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
      booleans(result, command, "available");
      nullableStrings(result, command, "message");
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
    case "repositorySnapshot":
      assert(isRepositorySnapshot(value), command, "expected a repository snapshot");
      break;
    case "repositoryMutationOutcome": {
      const result = record(value, command);
      assert(isRepositorySnapshot(result.snapshot), command, "expected a mutation snapshot");
      assertRepositorySlices(result.invalidatedSlices, command);
      break;
    }
    case "workingTreeMutationOutcome": {
      const result = record(value, command);
      assertTrackedChangeScan(result.tracked, command);
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
    case "nullableCommitDetails":
      if (value !== null) assertCommitDetails(value, command);
      break;
    case "commitDiffResult": {
      const result = record(value, command);
      strings(result, command, "repositoryId", "oid", "path", "patch");
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
    typeof value.untrackedState === "string"
  );
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

function record(value: unknown, command: DesktopCommandName): TransportRecord {
  assert(isRecord(value), command, "expected an object");
  return value;
}

function strings(
  value: TransportRecord,
  command: DesktopCommandName,
  ...keys: string[]
): void {
  for (const key of keys) assert(typeof value[key] === "string", command, `${key} must be a string`);
}

function nullableStrings(
  value: TransportRecord,
  command: DesktopCommandName,
  ...keys: string[]
): void {
  for (const key of keys) {
    assert(value[key] === null || typeof value[key] === "string", command, `${key} must be a string or null`);
  }
}

function arrays(
  value: TransportRecord,
  command: DesktopCommandName,
  ...keys: string[]
): void {
  for (const key of keys) assert(Array.isArray(value[key]), command, `${key} must be an array`);
}

function numbers(
  value: TransportRecord,
  command: DesktopCommandName,
  ...keys: string[]
): void {
  for (const key of keys) assert(typeof value[key] === "number", command, `${key} must be a number`);
}

function booleans(
  value: TransportRecord,
  command: DesktopCommandName,
  ...keys: string[]
): void {
  for (const key of keys) assert(typeof value[key] === "boolean", command, `${key} must be a boolean`);
}

function isRecord(value: unknown): value is TransportRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assert(
  condition: boolean,
  command: DesktopCommandName,
  message: string,
): asserts condition {
  if (!condition) throw new Error(`Invalid response from desktop command ${command}: ${message}.`);
}
