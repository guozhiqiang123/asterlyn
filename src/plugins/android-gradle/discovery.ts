import type { AndroidGradleEvidenceSnapshot } from "./detector.ts";
import type { TaskExecutionRequest, TaskDescriptor, TaskProviderSnapshot } from "./sdk-compat.ts";

export const ANDROID_GRADLE_DISCOVERY_LIMITS = Object.freeze({
  maxOutputBytes: 2 * 1024 * 1024,
  maxLineLength: 16 * 1024,
  maxTasks: 32_768,
});

export const ANDROID_GRADLE_EXECUTION_FLAGS = Object.freeze([
  "--console=plain", "--no-daemon", "--no-scan",
]);
export const ANDROID_GRADLE_TASK_ARGS = Object.freeze([
  "tasks", "--all", ...ANDROID_GRADLE_EXECUTION_FLAGS,
]);

export type GradleTaskDescriptor = TaskDescriptor;

export interface GradleTaskDiscoveryResult extends TaskProviderSnapshot {
  readonly tasks: readonly GradleTaskDescriptor[];
}

export type GradleWrapperRequestResult =
  | { readonly supported: true; readonly request: TaskExecutionRequest }
  | { readonly supported: false; readonly reason: "wrapper-missing" | "platform-mismatch" | "unsupported-evidence" };

export function buildGradleWrapperRequest(
  evidence: AndroidGradleEvidenceSnapshot,
): GradleWrapperRequestResult {
  if (!evidence.gradle || !evidence.android) return { supported: false, reason: "unsupported-evidence" };
  if (!evidence.bounded || evidence.catalogTruncated) return { supported: false, reason: "unsupported-evidence" };
  const expected = evidence.platform === "windows" ? "gradlew.bat" : "gradlew";
  if (!evidence.wrapper) return { supported: false, reason: "wrapper-missing" };
  if (evidence.wrapper !== expected) return { supported: false, reason: "platform-mismatch" };
  return {
    supported: true,
    request: {
      pluginId: "dev.asterlyn.android-gradle",
      providerId: "gradle-tasks",
      taskId: "discover",
      label: "Gradle tasks",
      executablePath: expected,
      args: [...ANDROID_GRADLE_TASK_ARGS],
    },
  };
}

export function parseGradleTasksOutput(
  output: Uint8Array | string,
): GradleTaskDiscoveryResult {
  const bytes = typeof output === "string" ? new TextEncoder().encode(output) : output;
  if (bytes.byteLength > ANDROID_GRADLE_DISCOVERY_LIMITS.maxOutputBytes) return errorSnapshot("Gradle output exceeded the discovery limit.");
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const lines = text.split(/\r?\n/u);
  const records = new Map<string, GradleTaskDescriptor>();
  let group = "Other";
  let projectPath = ":";
  let inTaskGroup = false;
  let malformed = false;
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const line = stripAnsi(rawLine).trimEnd();
    if (line.length > ANDROID_GRADLE_DISCOVERY_LIMITS.maxLineLength) { malformed = true; break; }
    if (!line.trim()) continue;
    if (/^(?:FAILURE:|BUILD FAILED|Could not determine)/u.test(line.trim())) return errorSnapshot("Gradle task discovery failed.");
    const rootProject = line.match(/Tasks runnable from root project ['"]([^'"]+)['"]/u);
    if (rootProject) { projectPath = ":"; inTaskGroup = false; continue; }
    const projectHeader = line.match(/Tasks runnable from project ['"]([^'"]+)['"]/u);
    if (projectHeader?.[1]) { projectPath = projectHeader[1].startsWith(":") ? projectHeader[1] : `:${projectHeader[1]}`; inTaskGroup = false; continue; }
    const next = stripAnsi(lines[index + 1] ?? "").trim();
    if (/^-{3,}$/u.test(next)) {
      inTaskGroup = /^\s*[A-Za-z][\w -]* tasks\s*$/u.test(line) && !line.includes(":") && !line.includes(" - ");
      if (inTaskGroup) group = line.trim();
      continue;
    }
    if (/^-{3,}$/u.test(line.trim()) || !inTaskGroup) continue;
    const match = line.match(/^\s*((?::[A-Za-z0-9_.-]+)+|[A-Za-z][A-Za-z0-9_.-]*(?::[A-Za-z0-9_.-]+)*)\s*(?:-\s*(.*))?\s*$/u);
    const taskName = match?.[1];
    if (!taskName) continue;
    const id = taskName.startsWith(":")
      ? taskName
      : taskName.includes(":")
        ? `:${taskName}`
        : `${projectPath === ":" ? ":" : `${projectPath}:`}${taskName}`;
    const projectSegments = id.startsWith(":") ? id.slice(1).split(":").slice(0, -1).join(":") : "";
    const taskProjectPath = projectSegments ? `:${projectSegments}` : ":";
    const description = match[2]?.trim() || undefined;
    const existing = records.get(id);
    if (!existing) {
      if (records.size >= ANDROID_GRADLE_DISCOVERY_LIMITS.maxTasks) return errorSnapshot("Gradle task list exceeded the discovery limit.");
      records.set(id, { id, label: id, group, description, projectPath: taskProjectPath, runnable: false, disabledReason: "Task execution is not enabled yet." });
    } else if (!existing.description && description) {
      records.set(id, { ...existing, description });
    }
  }
  if (malformed) return errorSnapshot("Gradle task output contained an overlong line.");
  if (records.size === 0) return errorSnapshot("Gradle output contained no recognizable tasks.");
  return { status: "ready", tasks: [...records.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}

function errorSnapshot(error: string): GradleTaskDiscoveryResult {
  return { status: "error", tasks: [], error };
}

function stripAnsi(value: string): string {
  return value.replace(/[\u001B\u009B]\[[0-?]*[ -/]*[@-~]/gu, "");
}
