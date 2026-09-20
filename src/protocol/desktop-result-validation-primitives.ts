import type { DesktopCommandName } from "./generated-desktop-protocol.ts";

export type TransportRecord = Record<string, unknown>;

export function record(value: unknown, command: DesktopCommandName): TransportRecord {
  assert(isRecord(value), command, "expected an object");
  return value;
}

export function strings(
  value: TransportRecord,
  command: DesktopCommandName,
  ...keys: string[]
): void {
  for (const key of keys) assert(typeof value[key] === "string", command, `${key} must be a string`);
}

export function nullableStrings(
  value: TransportRecord,
  command: DesktopCommandName,
  ...keys: string[]
): void {
  for (const key of keys) {
    assert(value[key] === null || typeof value[key] === "string", command, `${key} must be a string or null`);
  }
}

export function arrays(
  value: TransportRecord,
  command: DesktopCommandName,
  ...keys: string[]
): void {
  for (const key of keys) assert(Array.isArray(value[key]), command, `${key} must be an array`);
}

export function numbers(
  value: TransportRecord,
  command: DesktopCommandName,
  ...keys: string[]
): void {
  for (const key of keys) assert(typeof value[key] === "number", command, `${key} must be a number`);
}

export function booleans(
  value: TransportRecord,
  command: DesktopCommandName,
  ...keys: string[]
): void {
  for (const key of keys) assert(typeof value[key] === "boolean", command, `${key} must be a boolean`);
}

export function isRecord(value: unknown): value is TransportRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assert(
  condition: boolean,
  command: DesktopCommandName,
  message: string,
): asserts condition {
  if (!condition) throw new Error(`Invalid response from desktop command ${command}: ${message}.`);
}
