import type {
  RepositoryStateSlice,
  WorkspaceWatchInvalidation,
  WorkspaceWatchStatus,
} from "../models.ts";

export const WORKSPACE_WATCH_EVENT = "workspace-watch-invalidation";
const MAX_WATCH_PATHS = 512;
const MAX_WORKSPACE_PATH_LENGTH = 4_096;

export interface WorkspaceWatchBridge {
  readonly native: boolean;
  start(
    workspaceRoot: string,
    generation: number,
    openDocumentPaths: string[],
  ): Promise<WorkspaceWatchStatus>;
  stop(): Promise<void>;
  subscribe(listener: (invalidation: WorkspaceWatchInvalidation) => void): Promise<() => void>;
}

export function parseWorkspaceWatchInvalidation(value: unknown): WorkspaceWatchInvalidation {
  if (!isRecord(value)) throw new Error("Workspace-watch event must be an object.");
  if (
    typeof value.root !== "string" ||
    !value.root ||
    value.root.length > MAX_WORKSPACE_PATH_LENGTH ||
    value.root.includes("\0")
  ) {
    throw new Error("Workspace-watch event has no root.");
  }
  if (!Number.isSafeInteger(value.generation) || (value.generation as number) < 0) {
    throw new Error("Workspace-watch event has an invalid generation.");
  }
  if (!Number.isSafeInteger(value.watchInstance) || (value.watchInstance as number) <= 0) {
    throw new Error("Workspace-watch event has an invalid watch instance.");
  }
  const slices = parseSlices(value.slices);
  const paths = parseStrings(value.paths, "paths", MAX_WATCH_PATHS);
  const causes = parseStrings(value.causes, "causes", 2);
  if (slices.length === 0) throw new Error("Workspace-watch event has no state slices.");
  if (causes.length === 0) throw new Error("Workspace-watch event has no causes.");
  assertUnique(slices, "state slices");
  assertUnique(paths, "paths");
  assertUnique(causes, "causes");
  if (!paths.every(validWorkspacePath)) {
    throw new Error("Workspace-watch event has an invalid workspace path.");
  }
  if (!causes.every((cause) => cause === "watcher" || cause === "overflowRecovery")) {
    throw new Error("Workspace-watch event has an invalid cause.");
  }
  if (
    value.recovery !== "none" &&
    value.recovery !== "pathsTruncated" &&
    value.recovery !== "rootAmbiguous" &&
    value.recovery !== "backendOverflow"
  ) {
    throw new Error("Workspace-watch event has an invalid recovery class.");
  }
  if (value.recovery !== "none" && paths.length > 0) {
    throw new Error("Workspace-watch recovery events cannot claim exact paths.");
  }
  if (
    value.recovery === "backendOverflow" &&
    !SESSION_RECOVERY_SLICES.every((slice) => slices.includes(slice))
  ) {
    throw new Error("Workspace-watch backend overflow must request complete recovery.");
  }
  if (
    value.recovery === "rootAmbiguous" &&
    !["workspaceCatalog", "openDocuments", "repositoryCapability"].every((slice) =>
      slices.includes(slice as RepositoryStateSlice)
    )
  ) {
    throw new Error("Workspace-watch root recovery is missing required slices.");
  }
  if (
    (value.recovery === "backendOverflow") !== causes.includes("overflowRecovery")
  ) {
    throw new Error("Workspace-watch recovery cause is inconsistent.");
  }
  return {
    root: value.root,
    generation: value.generation as number,
    watchInstance: value.watchInstance as number,
    slices,
    paths,
    causes: causes as WorkspaceWatchInvalidation["causes"],
    recovery: value.recovery,
  };
}

function parseSlices(value: unknown): RepositoryStateSlice[] {
  const known = new Set<RepositoryStateSlice>([
    "workspaceCatalog",
    "openDocuments",
    "repositoryCapability",
    "workingTree",
    "head",
    "refs",
    "history",
    "operation",
  ]);
  const slices = parseStrings(value, "slices");
  if (!slices.every((slice) => known.has(slice as RepositoryStateSlice))) {
    throw new Error("Workspace-watch event has an invalid state slice.");
  }
  return slices as RepositoryStateSlice[];
}

function parseStrings(value: unknown, field: string, limit = Number.MAX_SAFE_INTEGER): string[] {
  if (
    !Array.isArray(value) ||
    value.length > limit ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new Error(`Workspace-watch event has invalid ${field}.`);
  }
  return value;
}

const SESSION_RECOVERY_SLICES: readonly RepositoryStateSlice[] = [
  "workspaceCatalog",
  "openDocuments",
  "repositoryCapability",
  "workingTree",
  "head",
  "refs",
  "history",
  "operation",
];

function assertUnique(values: string[], field: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Workspace-watch event has duplicate ${field}.`);
  }
}

function validWorkspacePath(path: string): boolean {
  if (
    !path ||
    path.length > MAX_WORKSPACE_PATH_LENGTH ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    path.includes("\\") ||
    path.includes("\0") ||
    /^[a-zA-Z]:/.test(path)
  ) return false;
  return path.split("/").every((component) =>
    component.length > 0 && component !== "." && component !== ".."
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
