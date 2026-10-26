import type { LanguageServiceResultEnvelope, LanguageServiceReview } from "./language-service.ts";
import type { DesktopCommandName } from "./generated-desktop-protocol.ts";
import { assert, record } from "./desktop-result-validation-primitives.ts";

const MAX_ID = 128;
const MAX_DIGEST = 256;
const MAX_RESULT_BYTES = 4 * 1024 * 1024;

function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function assertLanguageServiceReview(value: unknown, command: DesktopCommandName = "prepare_language_service"): asserts value is LanguageServiceReview {
  const item = record(value, command);
  assert(boundedString(item.reviewId, MAX_ID), command, "reviewId must be a bounded string");
  assert(item.pluginId === "dev.asterlyn.lsp", command, "pluginId is not admitted");
  assert(item.serverId === "typescript", command, "serverId is not admitted");
  assert(boundedString(item.pluginVersion, MAX_ID), command, "pluginVersion must be a bounded string");
  assert(boundedString(item.packageDigest, MAX_DIGEST), command, "packageDigest must be a bounded string");
  assert(boundedString(item.resourceDigest, MAX_DIGEST), command, "resourceDigest must be a bounded string");
  assert(boundedString(item.executableIdentity, MAX_DIGEST), command, "executableIdentity must be a bounded string");
  assert(Number.isSafeInteger(item.expiresAt) && Number(item.expiresAt) > 0, command, "expiresAt must be a positive integer");
}

export function assertLanguageServiceResultEnvelope(value: unknown, command: DesktopCommandName = "request_language_service"): asserts value is LanguageServiceResultEnvelope {
  const item = record(value, command);
  assert(boundedString(item.sessionId, MAX_ID), command, "sessionId must be a bounded string");
  assert(boundedString(item.uri, 4096), command, "uri must be a bounded string");
  assert(Number.isSafeInteger(item.version) && Number(item.version) > 0, command, "version must be a positive integer");
  assert(Object.prototype.hasOwnProperty.call(item, "result"), command, "result is required");
  let encoded: string;
  try { encoded = JSON.stringify(item.result) ?? ""; } catch { encoded = ""; }
  assert(encoded.length > 0 && new TextEncoder().encode(encoded).length <= MAX_RESULT_BYTES, command, "result exceeds the size limit or is not JSON serializable");
}


export function validateLanguageServiceDesktopResult(validator: string, value: unknown, command: DesktopCommandName): boolean {
  if (validator === "languageServiceReview") { assertLanguageServiceReview(value, command); return true; }
  if (validator === "languageServiceResultEnvelope") { assertLanguageServiceResultEnvelope(value, command); return true; }
  return false;
}
