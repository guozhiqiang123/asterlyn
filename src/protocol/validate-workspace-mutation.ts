import type { DesktopCommandName } from "./generated-desktop-protocol.ts";
import {
  arrays, assert, booleans, isRecord, nullableStrings, numbers, record, strings,
  type TransportRecord,
} from "./desktop-result-validation-primitives.ts";

export function assertWorkspaceEntryInspection(
  value: unknown,
  command: DesktopCommandName,
): void {
  const result = record(value, command);
  numbers(result, command, "entryCount", "totalBytes", "hiddenEntryCount");
  arrays(result, command, "symlinkPaths", "nestedRepositoryPaths", "multipleLinkPaths");
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
}

export function assertWorkspaceMutationPreview(value: unknown, command: DesktopCommandName): void {
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
  for (const blocker of result.blockers as unknown[]) assertWorkspaceMutationBlocker(blocker, command);
}

export function assertWorkspaceMutationOutcome(value: unknown, command: DesktopCommandName): void {
  const result = record(value, command);
  strings(result, command, "planId", "status");
  arrays(result, command, "affectedPaths", "pathRemaps", "invalidatedSlices");
  nullableStrings(result, command, "recoveryId", "error");
  assert(
    ["completed", "noOp", "cancelledBeforeWrite", "failedWithoutChange", "failedWithRecovery", "uncertain"].includes(result.status as string),
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
}

export function assertWorkspaceMutationRecoveryList(
  value: unknown,
  command: DesktopCommandName,
): void {
  assert(Array.isArray(value), command, "expected a workspace mutation recovery list");
  for (const recovery of value as unknown[]) {
    const result = record(recovery, command);
    strings(result, command, "recoveryId", "workspaceRoot", "phase");
    nullableStrings(result, command, "destination");
    arrays(result, command, "sourceStates", "supportedActions");
    for (const sourceState of result.sourceStates as unknown[]) {
      const state = record(sourceState, command);
      strings(state, command, "path", "state");
      assert(isRecoveryPathState(state.state), command, "source state must be supported");
    }
    assert(
      result.destinationState === null || isRecoveryPathState(result.destinationState),
      command,
      "destinationState must be a supported path state or null",
    );
    assert(
      result.heldSourceState === null || isRecoveryPathState(result.heldSourceState),
      command,
      "heldSourceState must be a supported path state or null",
    );
    assert(
      (result.supportedActions as unknown[]).every((action) =>
        action === "rollback" || action === "finalize" || action === "acknowledge"
      ),
      command,
      "supportedActions contains an unsupported recovery action",
    );
    assertWorkspaceMutationOperation(result.operation, command);
  }
}

function assertWorkspaceMutationOperation(value: unknown, command: DesktopCommandName): void {
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
      if ("sources" in operation) {
        assertStringArray(operation.sources, command, "sources");
        assert(operation.sources.length > 0 && operation.sources.every(Boolean), command, "sources must contain non-empty paths");
      } else {
        assert(typeof operation.source === "string" && operation.source.length > 0, command, "source must not be empty");
      }
      break;
    default:
      assert(false, command, "operation kind must be supported");
  }
}

function isRecoveryPathState(value: unknown): boolean {
  return value === "missing" || value === "matchesReviewed" || value === "changedOrUnknown";
}

function isWorkspaceEntryIdentity(value: unknown): value is TransportRecord {
  return isRecord(value) &&
    typeof value.workspacePath === "string" &&
    (value.kind === "file" || value.kind === "directory") &&
    typeof value.revision === "string" &&
    typeof value.mode === "number" && Number.isSafeInteger(value.mode) && value.mode >= 0 &&
    typeof value.byteLength === "number" && Number.isSafeInteger(value.byteLength) && value.byteLength >= 0;
}

function assertWorkspaceMutationBlocker(value: unknown, command: DesktopCommandName): void {
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

function assertStringArray(
  value: unknown,
  command: DesktopCommandName,
  field: string,
): asserts value is string[] {
  assert(Array.isArray(value) && value.every((item) => typeof item === "string"), command, `${field} must contain only strings`);
}

function assertNonNegativeInteger(value: unknown, command: DesktopCommandName, name: string): void {
  assert(
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
    command,
    `${name} must be a non-negative integer`,
  );
}
