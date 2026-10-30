import type { LanguageServiceResultEnvelope, LanguageServiceReview, LanguageServiceWorkspaceState, LanguageServiceProgress } from "./language-service.ts";
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
  assert(typeof item.serverId === "string" && /^[a-z][a-z0-9.-]{0,127}$/u.test(item.serverId), command, "serverId is not admitted");
  assert(boundedString(item.pluginVersion, MAX_ID), command, "pluginVersion must be a bounded string");
  assert(boundedString(item.packageDigest, MAX_DIGEST), command, "packageDigest must be a bounded string");
  assert(boundedString(item.resourceDigest, MAX_DIGEST), command, "resourceDigest must be a bounded string");
  assert(boundedString(item.executableIdentity, MAX_DIGEST), command, "executableIdentity must be a bounded string");
  assert(Number.isSafeInteger(item.expiresAt) && Number(item.expiresAt) > 0, command, "expiresAt must be a positive integer");
  assert(item.remembered === undefined || typeof item.remembered === "boolean",command,"remembered must be a boolean");
}
export function assertLanguageServiceWorkspaceState(value: unknown, command: DesktopCommandName = "language_service_workspace_state"): asserts value is LanguageServiceWorkspaceState {
  const item=record(value,command);
  assert(typeof item.debugTracing === "boolean",command,"debugTracing must be a boolean");
  assert(Array.isArray(item.startupProfiles)&&item.startupProfiles.length<=16,command,"invalid startup profiles");
  for(const entry of item.startupProfiles){const profile=record(entry,command);assert(profile.pluginId==="dev.asterlyn.lsp"&&typeof profile.serverId==="string"&&/^[a-z][a-z0-9.-]{0,127}$/u.test(profile.serverId),command,"invalid startup profile identity");}
}
export function languageServiceProgress(value: unknown):LanguageServiceProgress|undefined {
  if(!value || typeof value!=="object" || Array.isArray(value))return undefined;
  const p=value as Record<string,unknown>;
  if(Object.keys(p).some(key=>!["phase","completed","total","unit"].includes(key)) || !["model","sources","backend","indexing","refreshing","ready","failed"].includes(String(p.phase)))return undefined;
  for(const key of ["completed","total"])if(p[key]!==undefined && (!Number.isSafeInteger(p[key])||Number(p[key])<0||Number(p[key])>1_000_000||(key==="total"&&p[key]===0)))return undefined;
  if(p.completed!==undefined&&p.total!==undefined&&Number(p.completed)>Number(p.total))return undefined;
  if(p.unit!==undefined&&!["modules","files","items"].includes(String(p.unit)))return undefined;
  return p as unknown as LanguageServiceProgress;
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
  if (validator === "languageServiceWorkspaceState") { assertLanguageServiceWorkspaceState(value,command);return true; }
  if (validator === "languageServiceReview") { assertLanguageServiceReview(value, command); return true; }
  if (validator === "languageServiceResultEnvelope") { assertLanguageServiceResultEnvelope(value, command); return true; }
  return false;
}
