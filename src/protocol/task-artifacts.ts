import type { TaskArtifactDiscovery, TaskArtifactKind } from "../models.ts";

export const TASK_ARTIFACT_LIMITS = Object.freeze({
  maxHints: 8,
  maxHintBytes: 4_096,
  maxArtifacts: 64,
  maxPathBytes: 4_096,
  maxFileBytes: 1_073_741_824,
  maxTotalBytes: 2_147_483_648,
});

export interface TaskArtifactBridge {
  discoverTaskArtifacts(repositoryRoot: string, hints: readonly string[]): Promise<TaskArtifactDiscovery>;
  revealTaskArtifact(repositoryRoot: string, workspacePath: string): Promise<void>;
}

export function parseTaskArtifactDiscovery(value: unknown): TaskArtifactDiscovery {
  const source = record(value, "Task artifact discovery");
  if (source.protocolVersion !== 1) throw new Error("Task artifact discovery has unsupported protocol version.");
  const workspaceRoot = boundedText(source.workspaceRoot, "workspaceRoot", 16_384);
  if (!Array.isArray(source.artifacts) || source.artifacts.length > TASK_ARTIFACT_LIMITS.maxArtifacts) {
    throw new Error("Task artifacts are invalid or exceed the result limit.");
  }
  if (typeof source.truncated !== "boolean") throw new Error("Task artifact truncated is invalid.");
  const seen = new Set<string>();
  const artifacts = source.artifacts.map((candidate) => {
    const artifact = record(candidate, "Task artifact");
    const workspacePath = workspaceRelativePath(artifact.workspacePath);
    const kind = artifactKind(artifact.kind);
    const byteLength = artifactBytes(artifact.byteLength);
    if (seen.has(workspacePath)) throw new Error("Task artifact paths must be unique.");
    seen.add(workspacePath);
    const extension = workspacePath.slice(workspacePath.lastIndexOf(".") + 1).toLowerCase();
    if (extension !== kind) throw new Error("Task artifact kind does not match its path.");
    return { workspacePath, kind, byteLength };
  });
  const totalBytes = artifacts.reduce((total, artifact) => total + artifact.byteLength, 0);
  if (totalBytes > TASK_ARTIFACT_LIMITS.maxTotalBytes) throw new Error("Task artifacts exceed the total size limit.");
  artifacts.sort((left, right) => left.workspacePath < right.workspacePath ? -1 : left.workspacePath > right.workspacePath ? 1 : 0);
  return { protocolVersion: 1, workspaceRoot, artifacts, truncated: source.truncated };
}

export function validTaskArtifactHints(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= TASK_ARTIFACT_LIMITS.maxHints &&
    value.every((hint) => validTaskArtifactHint(hint));
}

export function validTaskArtifactHint(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || utf8Bytes(value) > TASK_ARTIFACT_LIMITS.maxHintBytes || value.includes("\0")) return false;
  if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/u.test(value)) return false;
  const parts = value.split(/[\\/]/u);
  if (parts.some((part) => !part || part === "." || part === "..")) return false;
  return parts.length >= 3 && parts.at(-3) === "build" && parts.at(-2) === "outputs" &&
    (parts.at(-1) === "apk" || parts.at(-1) === "bundle");
}

function workspaceRelativePath(value: unknown): string {
  const path = boundedText(value, "workspacePath", TASK_ARTIFACT_LIMITS.maxPathBytes);
  if (path.startsWith("/") || path.startsWith("\\") || path.includes("\\") || /^[A-Za-z]:/u.test(path)) {
    throw new Error("Task artifact workspacePath must be a normalized relative path.");
  }
  if (path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Task artifact workspacePath contains an invalid component.");
  }
  return path;
}

function artifactKind(value: unknown): TaskArtifactKind {
  if (value !== "apk" && value !== "aab") throw new Error("Task artifact kind is invalid.");
  return value;
}

function artifactBytes(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > TASK_ARTIFACT_LIMITS.maxFileBytes) {
    throw new Error("Task artifact byteLength is invalid.");
  }
  return value as number;
}

function boundedText(value: unknown, field: string, limit: number): string {
  if (typeof value !== "string" || !value || utf8Bytes(value) > limit || value.includes("\0")) {
    throw new Error(`Task artifact ${field} is invalid.`);
  }
  return value;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
