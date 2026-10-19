import type { DesktopCommandName } from "./generated-desktop-protocol.ts";
import { assert, isRecord, record } from "./desktop-result-validation-primitives.ts";

export type PluginRuntimeValue =
  | null
  | boolean
  | number
  | string
  | readonly PluginRuntimeValue[]
  | { readonly [key: string]: PluginRuntimeValue };

export interface PluginRuntimeCallbackReference {
  readonly $asterlynCallback: {
    readonly handle: string;
    readonly operation: string;
  };
}

const REMOTE_CALLBACK_MARKER = "$asterlynCallback";
const MAX_RUNTIME_VALUE_DEPTH = 32;
const MAX_CALLBACKS_PER_RESULT = 64;

export type PluginRuntimeTheme = "light" | "dark" | "highContrast";
export type ExternalPluginContributionKind =
  | "command"
  | "taskProvider"
  | "executionTargetProvider"
  | "runConfigurationProvider";

export interface ExternalPluginContribution {
  readonly kind: ExternalPluginContributionKind;
  readonly id: string;
  readonly payload: PluginRuntimeValue;
  readonly callbacks: Readonly<Record<string, string>>;
}

export interface InstalledPluginActivation {
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly packageDigest: string;
  readonly sessionId: string;
  readonly contributions: readonly ExternalPluginContribution[];
}

export interface InstalledPluginRuntimeDiagnostics {
  readonly stderr: string;
  readonly stderrTruncated: boolean;
  readonly protocolDiagnostics: readonly string[];
}

export interface InstalledPluginRuntimeBridge {
  activate(
    pluginId: string,
    workspaceRoot: string,
    workspaceGeneration: number,
    evidence: PluginRuntimeValue,
    locale: string,
    theme: PluginRuntimeTheme,
  ): Promise<InstalledPluginActivation>;
  invoke(
    pluginId: string,
    callbackHandle: string,
    operation: string,
    payload: PluginRuntimeValue,
  ): Promise<PluginRuntimeValue>;
  deactivate(pluginId: string): Promise<void>;
  diagnostics(pluginId: string): Promise<InstalledPluginRuntimeDiagnostics>;
}

export function validateInstalledPluginActivation(
  value: unknown,
  command: DesktopCommandName,
): InstalledPluginActivation {
  const activation = record(value, command);
  for (const field of ["pluginId", "pluginVersion", "packageDigest", "sessionId"] as const) {
    assertNonEmptyString(activation[field], command, field);
  }
  assert(Array.isArray(activation.contributions), command, "contributions must be an array");
  assert(activation.contributions.length <= 64, command, "too many runtime contributions");
  const ids = new Set<string>();
  const handles = new Set<string>();
  for (const raw of activation.contributions) {
    const contribution = record(raw, command);
    assert(
      contribution.kind === "command" ||
      contribution.kind === "taskProvider" ||
      contribution.kind === "executionTargetProvider" ||
      contribution.kind === "runConfigurationProvider",
      command,
      "invalid runtime contribution kind",
    );
    assertNonEmptyString(contribution.id, command, "contribution.id");
    assert(!ids.has(contribution.id), command, "duplicate runtime contribution ID");
    ids.add(contribution.id);
    validateRuntimeValue(contribution.payload, command, 0, false, new Set());
    assert(isRecord(contribution.callbacks), command, "contribution callbacks must be a record");
    assert(Object.keys(contribution.callbacks).length <= 32, command, "too many contribution callbacks");
    for (const [operation, handle] of Object.entries(contribution.callbacks)) {
      assertNonEmptyString(operation, command, "callback operation");
      assertNonEmptyString(handle, command, "callback handle");
      assert(!handles.has(handle), command, "duplicate runtime callback handle");
      handles.add(handle);
    }
  }
  return value as InstalledPluginActivation;
}

export function validateInstalledPluginRuntimeDiagnostics(
  value: unknown,
  command: DesktopCommandName,
): InstalledPluginRuntimeDiagnostics {
  const diagnostics = record(value, command);
  assert(typeof diagnostics.stderr === "string", command, "stderr must be a string");
  assert(
    typeof diagnostics.stderrTruncated === "boolean",
    command,
    "stderrTruncated must be a boolean",
  );
  assert(
    Array.isArray(diagnostics.protocolDiagnostics) &&
    diagnostics.protocolDiagnostics.length <= 64 &&
    diagnostics.protocolDiagnostics.every((message) => typeof message === "string"),
    command,
    "protocolDiagnostics must be a bounded string array",
  );
  return value as InstalledPluginRuntimeDiagnostics;
}

export function validatePluginRuntimeValue(
  value: unknown,
  command: DesktopCommandName,
): PluginRuntimeValue {
  validateRuntimeValue(value, command, 0, true, new Set());
  return value as PluginRuntimeValue;
}

function validateRuntimeValue(
  value: unknown,
  command: DesktopCommandName,
  depth: number,
  allowRemoteCallbacks: boolean,
  callbackHandles: Set<string>,
): void {
  assert(depth <= MAX_RUNTIME_VALUE_DEPTH, command, "runtime value nesting is too deep");
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    assert(Number.isFinite(value), command, "runtime number must be finite");
    return;
  }
  if (Array.isArray(value)) {
    assert(value.length <= 65_536, command, "runtime array is too large");
    for (const item of value) {
      validateRuntimeValue(item, command, depth + 1, allowRemoteCallbacks, callbackHandles);
    }
    return;
  }
  assert(isRecord(value), command, "runtime value must be JSON-compatible");
  const entries = Object.entries(value);
  assert(entries.length <= 65_536, command, "runtime object is too large");
  if (Object.hasOwn(value, REMOTE_CALLBACK_MARKER)) {
    assert(allowRemoteCallbacks, command, "remote callback references are not allowed here");
    assert(entries.length === 1, command, "remote callback reference must not have sibling fields");
    const reference = record(value[REMOTE_CALLBACK_MARKER], command);
    assert(
      Object.keys(reference).length === 2 &&
      Object.hasOwn(reference, "handle") &&
      Object.hasOwn(reference, "operation"),
      command,
      "remote callback reference has an invalid shape",
    );
    assertRuntimeIdentifier(reference.handle, command, "remote callback handle", true);
    assertRuntimeIdentifier(reference.operation, command, "remote callback operation", false);
    assert(
      callbackHandles.size < MAX_CALLBACKS_PER_RESULT,
      command,
      "too many remote callback references",
    );
    assert(!callbackHandles.has(reference.handle), command, "duplicate remote callback handle");
    callbackHandles.add(reference.handle);
    return;
  }
  for (const [key, item] of entries) {
    assert(key.length <= 4_096, command, "runtime object key is too long");
    validateRuntimeValue(item, command, depth + 1, allowRemoteCallbacks, callbackHandles);
  }
}

function assertRuntimeIdentifier(
  value: unknown,
  command: DesktopCommandName,
  field: string,
  allowPathSeparators: boolean,
): asserts value is string {
  assert(
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    (allowPathSeparators ? /^[A-Za-z0-9._:/-]+$/u : /^[A-Za-z0-9._-]+$/u).test(value),
    command,
    `${field} has an invalid format`,
  );
}

function assertNonEmptyString(
  value: unknown,
  command: DesktopCommandName,
  field: string,
): asserts value is string {
  assert(
    typeof value === "string" && value.length > 0 && value.length <= 4_096,
    command,
    `${field} must be a bounded non-empty string`,
  );
}
