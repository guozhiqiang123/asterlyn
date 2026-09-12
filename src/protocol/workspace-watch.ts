import type {
  RepositoryStateSlice,
  WorkspaceWatchInvalidation,
  WorkspaceWatchStatus,
} from "../models.ts";

export const WORKSPACE_WATCH_EVENT = "workspace-watch-invalidation";

export interface WorkspaceWatchBridge {
  readonly native: boolean;
  start(workspaceRoot: string, generation: number): Promise<WorkspaceWatchStatus>;
  stop(): Promise<void>;
  subscribe(listener: (invalidation: WorkspaceWatchInvalidation) => void): Promise<() => void>;
}

export function parseWorkspaceWatchInvalidation(value: unknown): WorkspaceWatchInvalidation {
  if (!isRecord(value)) throw new Error("Workspace-watch event must be an object.");
  if (typeof value.root !== "string" || !value.root) {
    throw new Error("Workspace-watch event has no root.");
  }
  if (!Number.isSafeInteger(value.generation) || (value.generation as number) < 0) {
    throw new Error("Workspace-watch event has an invalid generation.");
  }
  const slices = parseSlices(value.slices);
  const paths = parseStrings(value.paths, "paths");
  const causes = parseStrings(value.causes, "causes");
  if (!causes.every((cause) => cause === "watcher" || cause === "overflowRecovery")) {
    throw new Error("Workspace-watch event has an invalid cause.");
  }
  if (typeof value.overflowed !== "boolean") {
    throw new Error("Workspace-watch event has an invalid overflow flag.");
  }
  return {
    root: value.root,
    generation: value.generation as number,
    slices,
    paths,
    causes: causes as WorkspaceWatchInvalidation["causes"],
    overflowed: value.overflowed,
  };
}

function parseSlices(value: unknown): RepositoryStateSlice[] {
  const known = new Set<RepositoryStateSlice>([
    "workspaceCatalog",
    "openDocuments",
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

function parseStrings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Workspace-watch event has invalid ${field}.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
