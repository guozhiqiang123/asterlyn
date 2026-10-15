import type { TaskDescriptor } from "../../application/tasks/task-types.ts";

export const ANDROID_GRADLE_CACHE_SCHEMA_VERSION = 1;
export const ANDROID_GRADLE_PARSER_VERSION = 1;
export const ANDROID_GRADLE_DISCOVERY_PROTOCOL_VERSION = 1;
export const ANDROID_GRADLE_CACHE_LIMITS = Object.freeze({ maxTasks: 32_768, maxPayloadBytes: 16 * 1024 * 1024 });

export interface AndroidGradleCachePayload {
  readonly schemaVersion: 1;
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly providerId: string;
  readonly parserVersion: 1;
  readonly discoveryProtocolVersion: 1;
  readonly tasks: readonly TaskDescriptor[];
}

export function encodeAndroidGradleCachePayload(
  tasks: readonly TaskDescriptor[],
  pluginId: string,
  pluginVersion: string,
  providerId: string,
): string {
  if (tasks.length > ANDROID_GRADLE_CACHE_LIMITS.maxTasks) throw new Error("Android Gradle cache task count exceeds the limit.");
  const payload: AndroidGradleCachePayload = {
    schemaVersion: 1, pluginId, pluginVersion, providerId, parserVersion: 1,
    discoveryProtocolVersion: 1,
    tasks: tasks.map(({ runState: _runState, disabledReason: _disabledReason, ...task }) => ({ ...task, runnable: false })),
  };
  const text = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > ANDROID_GRADLE_CACHE_LIMITS.maxPayloadBytes) throw new Error("Android Gradle cache payload exceeds the limit.");
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)));
  }
  return btoa(chunks.join(""));
}

export function decodeAndroidGradleCachePayload(
  payloadBase64: unknown,
  pluginId: string,
  pluginVersion: string,
  providerId: string,
): readonly TaskDescriptor[] | null {
  if (typeof payloadBase64 !== "string" || payloadBase64.length === 0 || payloadBase64.length > Math.ceil(ANDROID_GRADLE_CACHE_LIMITS.maxPayloadBytes / 3) * 4) return null;
  try {
    const binary = atob(payloadBase64);
    if (binary.length > ANDROID_GRADLE_CACHE_LIMITS.maxPayloadBytes) return null;
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const source: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!source || typeof source !== "object" || Array.isArray(source)) return null;
    const record = source as Record<string, unknown>;
    if (record.schemaVersion !== 1 || record.pluginId !== pluginId || record.pluginVersion !== pluginVersion ||
      record.providerId !== providerId || record.parserVersion !== 1 || record.discoveryProtocolVersion !== 1 ||
      !Array.isArray(record.tasks) || record.tasks.length > ANDROID_GRADLE_CACHE_LIMITS.maxTasks) return null;
    const tasks: TaskDescriptor[] = [];
    const taskIds = new Set<string>();
    for (const value of record.tasks) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const task = value as Record<string, unknown>;
      if (typeof task.id !== "string" || !task.id || task.id.length > 4096 || task.id.includes("\0") ||
        !/^:[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)*$/u.test(task.id) ||
        typeof task.label !== "string" || task.label.length === 0 || task.label.length > 256 || task.label.includes("\0") ||
        typeof task.group !== "string" || task.group.length === 0 || task.group.length > 256 || task.group.includes("\0") ||
        typeof task.projectPath !== "string" || !/^:(?:[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)*)?$/u.test(task.projectPath) ||
        task.runnable !== false || task.runState !== undefined || task.disabledReason !== undefined) return null;
      if (task.description !== undefined && (typeof task.description !== "string" || task.description.length > 256 || task.description.includes("\0"))) return null;
      if (taskIds.has(task.id) || projectPathForTask(task.id) !== task.projectPath) return null;
      taskIds.add(task.id);
      if (task.androidQuickAction !== undefined) {
        if (!task.androidQuickAction || typeof task.androidQuickAction !== "object" || Array.isArray(task.androidQuickAction)) return null;
        if (!isConsistentQuickAction(task.id, task.androidQuickAction as Record<string, unknown>)) return null;
      }
      tasks.push({ id: task.id, label: task.label, group: task.group, projectPath: task.projectPath,
        ...(task.description === undefined ? {} : { description: task.description }), runnable: false,
        ...(task.androidQuickAction === undefined ? {} : { androidQuickAction: task.androidQuickAction as TaskDescriptor["androidQuickAction"] }) });
    }
    return tasks;
  } catch {
    return null;
  }
}

export function fingerprintPaths(files: readonly { readonly workspacePath: string }[], platform: "posix" | "windows"): readonly string[] {
  const paths = files.map((file) => normalizePath(file.workspacePath, platform)).filter((path): path is string => path !== null);
  return [...new Set(paths.filter(isFingerprintCandidate))].sort();
}

export function normalizePath(value: string, platform: "posix" | "windows"): string | null {
  if (!value || value.length > 4096 || value.includes("\0")) return null;
  const path = platform === "windows" ? value.replaceAll("\\", "/").toLowerCase() : value;
  if (path.startsWith("/") || /^[a-z]:\//u.test(path) || path.startsWith("//")) return null;
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  return parts.join("/");
}

function isFingerprintCandidate(path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1);
  if (["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "gradle.properties", "gradlew", "gradlew.bat", "AndroidManifest.xml", "androidmanifest.xml", "gradle-wrapper.properties", "libs.versions.toml"].includes(base)) return true;
  if (path.startsWith("gradle/") && base.endsWith(".toml")) return true;
  return path.startsWith("gradle/wrapper/") && base === "gradle-wrapper.properties" ||
    (path.startsWith("buildSrc/") || path.startsWith("buildsrc/") || path.startsWith("build-logic/")) &&
      (/\.(gradle|gradle\.kts|toml|properties|kt|kts|java)$/u.test(base) || /version/i.test(base));
}

export function intersectsFingerprintPaths(candidates: readonly string[], changed: readonly string[], platform: "posix" | "windows"): boolean {
  const set = new Set(candidates);
  return changed.some((path) => { const normalized = normalizePath(path, platform); return normalized !== null && (set.has(normalized) || isFingerprintCandidate(normalized)); });
}

function isConsistentQuickAction(taskId: string, value: Record<string, unknown>): boolean {
  const kind = value.kind;
  const module = value.module;
  const variant = value.variant;
  if (!["assemble", "bundle", "install", "uninstall"].includes(kind as string) ||
    typeof module !== "string" || module.length > 512 || typeof variant !== "string" || variant.length === 0 || variant.length > 512 ||
    module.includes("\0") || variant.includes("\0") || !/^:(?:[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)*)?$/.test(module) ||
    !/^[A-Z][A-Za-z0-9_.-]*$/.test(variant)) return false;
  const match = taskId.match(/^((?::[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)*)?):(assemble|bundle|install|uninstall)([A-Z][A-Za-z0-9_.-]*)$/u);
  return Boolean(match && match[2] === kind && (match[1] || ":") === module && match[3] === variant);
}

function projectPathForTask(taskId: string): string {
  const segments = taskId.slice(1).split(":");
  return segments.length <= 1 ? ":" : `:${segments.slice(0, -1).join(":")}`;
}
