import type { CommitFileComparison, ImageDiffPreview, ImagePreview } from "../models.ts";

const MAX_CURRENT_BYTES = 16 * 1024 * 1024;
const MAX_PATCH_LENGTH = 4 * 1024 * 1024 + 128;

export function assertCommitFileComparison(
  value: unknown,
  command: string,
): asserts value is CommitFileComparison {
  assert(isRecord(value), command, "expected an object");
  for (const field of [
    "repositoryId",
    "commitOid",
    "revisionOid",
    "path",
    "sourcePath",
    "blobOid",
    "fileMode",
    "currentRevision",
    "currentSource",
    "kind",
  ]) {
    assert(typeof value[field] === "string", command, `${field} must be a string`);
  }
  assert(
    [value.commitOid, value.revisionOid, value.blobOid].every(isFullObjectId),
    command,
    "historical comparison identities must use full object IDs",
  );
  assert(
    typeof value.currentRevision === "string" && /^[0-9a-f]{64}$/iu.test(value.currentRevision),
    command,
    "currentRevision must be a full workspace revision",
  );
  assert(
    value.fileMode === "100644" || value.fileMode === "100755",
    command,
    "historical comparison mode must be a supported regular-file mode",
  );
  assert(
    value.currentSource === "disk" || value.currentSource === "buffer",
    command,
    "currentSource must identify disk or buffer content",
  );
  assert(
    typeof value.currentByteLength === "number" && Number.isSafeInteger(value.currentByteLength) &&
      value.currentByteLength >= 0 && value.currentByteLength <= MAX_CURRENT_BYTES,
    command,
    "currentByteLength exceeds the protocol bound",
  );
  assert(typeof value.truncated === "boolean", command, "truncated must be boolean");
  if (value.kind === "text") {
    assert(
      typeof value.patch === "string" && value.patch.length <= MAX_PATCH_LENGTH &&
        value.image === null,
      command,
      "text comparisons require a bounded patch only",
    );
    return;
  }
  assert(value.kind === "image", command, "comparison kind must be text or image");
  assert(
    value.patch === null && isImageDiffPreview(value.image) && value.truncated === false,
    command,
    "image comparisons require only a complete image Diff",
  );
}

function isFullObjectId(value: unknown): boolean {
  return typeof value === "string" && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/iu.test(value);
}

function isImageDiffPreview(value: unknown): value is ImageDiffPreview {
  return isRecord(value) && typeof value.path === "string" &&
    isImagePreview(value.before) && isImagePreview(value.after);
}

function isImagePreview(value: unknown): value is ImagePreview {
  return isRecord(value) &&
    typeof value.path === "string" && typeof value.mediaType === "string" &&
    typeof value.dataUrl === "string" && typeof value.width === "number" &&
    typeof value.height === "number" && typeof value.byteLength === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assert(condition: boolean, command: string, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid response from desktop command ${command}: ${message}.`);
}
