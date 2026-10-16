export type PluginToolOperationStatus =
  | "succeeded"
  | "failed"
  | "timedOut"
  | "cancelled"
  | "crashed";

export interface PluginToolOperationResult {
  protocolVersion: 1;
  pluginId: string;
  requestId: string;
  operationId: string;
  status: PluginToolOperationStatus;
  stdoutBase64: string;
  stderrBase64: string;
  truncated: boolean;
  exitCode: number | null;
  error: string | null;
}

export type PluginToolOperationParameters = Record<string, string>;

export interface PluginToolOperationBridge {
  executePluginToolOperation(
    workspaceRoot: string,
    pluginId: string,
    requestId: string,
    operationId: string,
    parameters: Readonly<PluginToolOperationParameters>,
  ): Promise<PluginToolOperationResult>;
  cancelPluginToolOperation(requestId: string): Promise<void>;
}

const STATUSES = new Set<PluginToolOperationStatus>([
  "succeeded", "failed", "timedOut", "cancelled", "crashed",
]);
const MAX_ID_LENGTH = 256;
const MAX_OUTPUT_BASE64_LENGTH = 1_398_104;
const MAX_ERROR_LENGTH = 16_384;

export function assertPluginToolOperationResult(value: unknown, label: string): asserts value is PluginToolOperationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: expected a plugin tool-operation result.`);
  }
  const result = value as Record<string, unknown>;
  if (result.protocolVersion !== 1) throw new Error(`${label}: unsupported plugin tool-operation protocol.`);
  if (!validText(result.pluginId, MAX_ID_LENGTH) || !validText(result.requestId, MAX_ID_LENGTH) || !validText(result.operationId, MAX_ID_LENGTH)) {
    throw new Error(`${label}: invalid plugin tool-operation identity.`);
  }
  if (!STATUSES.has(result.status as PluginToolOperationStatus)) throw new Error(`${label}: invalid plugin tool-operation status.`);
  if (!validBase64(result.stdoutBase64) || !validBase64(result.stderrBase64)) {
    throw new Error(`${label}: invalid or oversized plugin tool-operation output.`);
  }
  if (typeof result.truncated !== "boolean") throw new Error(`${label}: invalid plugin tool-operation truncation state.`);
  if (result.exitCode !== null && !Number.isSafeInteger(result.exitCode)) throw new Error(`${label}: invalid plugin tool-operation exit code.`);
  if (result.error !== null && !validText(result.error, MAX_ERROR_LENGTH)) throw new Error(`${label}: invalid plugin tool-operation error.`);
}

function validText(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= limit && !value.includes("\0");
}

function validBase64(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_OUTPUT_BASE64_LENGTH && value.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value);
}
