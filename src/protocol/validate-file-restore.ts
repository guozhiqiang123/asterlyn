const ACTIONS = new Set(["create", "overwrite", "unchanged"]);
const STATUSES = new Set(["applied", "unchanged", "rolledBack", "needsRecovery"]);
const STATES = new Set(["original", "restored", "conflict", "unavailable"]);

export function assertCommitFileRestorePreview(value: unknown, command: string): void {
  const result = record(value, command);
  stringFields(result, command, [
    "planId", "workspacePath", "action", "repositoryId", "commitOid", "revisionOid",
    "sourcePath", "blobOid", "fileMode",
  ]);
  assert(
    result.expectedRevision === null || typeof result.expectedRevision === "string",
    command,
    "expectedRevision must be a string or null",
  );
  integerFields(result, command, ["currentMode", "restoredMode", "restoredByteLength"]);
  assert(
    result.currentByteLength === null || nonNegativeInteger(result.currentByteLength),
    command,
    "currentByteLength must be a non-negative integer or null",
  );
  assert(ACTIONS.has(String(result.action)), command, "action must be a supported restore action");
}

export function assertFileRestoreApplyResult(value: unknown, command: string): void {
  assertFileRestoreSummary(value, command, true);
}

export function assertFileRestoreRecoveryList(value: unknown, command: string): void {
  assert(Array.isArray(value), command, "expected a file restore recovery list");
  for (const recovery of value as unknown[]) assertFileRestoreSummary(recovery, command, false);
}

function assertFileRestoreSummary(value: unknown, command: string, nullableId: boolean): void {
  const result = record(value, command);
  stringFields(result, command, ["workspacePath", "status", "fileState"]);
  assert(
    nullableId
      ? result.recoveryId === null || typeof result.recoveryId === "string"
      : typeof result.recoveryId === "string",
    command,
    `recoveryId must be ${nullableId ? "a string or null" : "a string"}`,
  );
  assert(STATUSES.has(String(result.status)), command, "status must be supported");
  assert(STATES.has(String(result.fileState)), command, "fileState must be supported");
}

function record(value: unknown, command: string): Record<string, unknown> {
  assert(Boolean(value) && typeof value === "object" && !Array.isArray(value), command, "expected an object");
  return value as Record<string, unknown>;
}

function stringFields(result: Record<string, unknown>, command: string, fields: string[]): void {
  for (const field of fields) assert(typeof result[field] === "string", command, `${field} must be a string`);
}

function integerFields(result: Record<string, unknown>, command: string, fields: string[]): void {
  for (const field of fields) assert(nonNegativeInteger(result[field]), command, `${field} must be a non-negative integer`);
}

function nonNegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function assert(condition: unknown, command: string, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid desktop response for ${command}: ${message}`);
}
