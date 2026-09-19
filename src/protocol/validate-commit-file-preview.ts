import type { CommitFilePreview, ImagePreview } from "../models.ts";

const MAX_COMMIT_FILE_BYTES = 16 * 1024 * 1024;

export function assertCommitFilePreview(
  value: unknown,
  command: string,
): asserts value is CommitFilePreview {
  assert(isRecord(value), command, "expected an object");
  for (const field of [
    "repositoryId",
    "commitOid",
    "revisionOid",
    "path",
    "sourcePath",
    "blobOid",
    "fileMode",
    "kind",
  ]) {
    assert(typeof value[field] === "string", command, `${field} must be a string`);
  }
  assert(
    value.utf8Bom === null || typeof value.utf8Bom === "boolean",
    command,
    "utf8Bom must be boolean or null",
  );
  assert(
    value.image === null || isImagePreview(value.image),
    command,
    "image must be an image preview or null",
  );
  assert(
    [value.commitOid, value.revisionOid, value.blobOid].every(isFullObjectId),
    command,
    "historical file identities must use full object IDs",
  );
  assert(
    value.fileMode === "100644" || value.fileMode === "100755",
    command,
    "historical file mode must be a supported regular-file mode",
  );
  assert(
    typeof value.byteLength === "number" && Number.isSafeInteger(value.byteLength) &&
      value.byteLength >= 0 && value.byteLength <= MAX_COMMIT_FILE_BYTES,
    command,
    "historical file byteLength exceeds the protocol bound",
  );
  if (value.kind === "text") {
    assert(
      typeof value.content === "string" && typeof value.utf8Bom === "boolean" &&
        value.image === null,
      command,
      "text historical files require content and BOM metadata only",
    );
    return;
  }
  assert(value.kind === "image", command, "historical file kind must be text or image");
  assert(
    value.content === null && value.utf8Bom === null && isImagePreview(value.image),
    command,
    "image historical files require only an image preview",
  );
}

function isFullObjectId(value: unknown): boolean {
  return typeof value === "string" && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/iu.test(value);
}

function isImagePreview(value: unknown): value is ImagePreview {
  if (!isRecord(value)) return false;
  return typeof value.path === "string" &&
    typeof value.mediaType === "string" &&
    typeof value.dataUrl === "string" &&
    typeof value.width === "number" &&
    typeof value.height === "number" &&
    typeof value.byteLength === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assert(condition: boolean, command: string, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid response from desktop command ${command}: ${message}.`);
}
