export type PluginProcessQueryStatus =
  | "succeeded"
  | "failed"
  | "unavailable"
  | "timedOut"
  | "cancelled"
  | "crashed";

export interface PluginProcessQueryResult {
  protocolVersion: 1;
  pluginId: string;
  queryId: string;
  status: PluginProcessQueryStatus;
  stdoutBase64: string;
  stderrBase64: string;
  truncated: boolean;
  exitCode: number | null;
  error: string | null;
}

export interface PluginProcessQueryBridge {
  executePluginProcessQuery(
    workspaceRoot: string,
    pluginId: string,
    queryId: string,
  ): Promise<PluginProcessQueryResult>;
}

const STATUSES = new Set<PluginProcessQueryStatus>([
  "succeeded",
  "failed",
  "unavailable",
  "timedOut",
  "cancelled",
  "crashed",
]);
const MAX_ID_LENGTH = 256;
const MAX_OUTPUT_BASE64_LENGTH = 349_528;
const MAX_ERROR_LENGTH = 16_384;

export function assertPluginProcessQueryResult(value: unknown, label: string): asserts value is PluginProcessQueryResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: expected a process query result.`);
  }
  const result = value as Record<string, unknown>;
  if (result.protocolVersion !== 1) throw new Error(`${label}: unsupported process query protocol.`);
  if (!validText(result.pluginId, MAX_ID_LENGTH) || !validText(result.queryId, MAX_ID_LENGTH)) {
    throw new Error(`${label}: invalid process query identity.`);
  }
  if (!STATUSES.has(result.status as PluginProcessQueryStatus)) {
    throw new Error(`${label}: invalid process query status.`);
  }
  if (!validBase64(result.stdoutBase64) || !validBase64(result.stderrBase64)) {
    throw new Error(`${label}: invalid or oversized process query output.`);
  }
  if (typeof result.truncated !== "boolean") throw new Error(`${label}: invalid process query truncation state.`);
  if (result.exitCode !== null && !Number.isSafeInteger(result.exitCode)) {
    throw new Error(`${label}: invalid process query exit code.`);
  }
  if (result.error !== null && !validText(result.error, MAX_ERROR_LENGTH)) {
    throw new Error(`${label}: invalid process query error.`);
  }
}

function validText(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= limit && !value.includes("\0");
}

function validBase64(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= MAX_OUTPUT_BASE64_LENGTH
    && value.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value);
}
