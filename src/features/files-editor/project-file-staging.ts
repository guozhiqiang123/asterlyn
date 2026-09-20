import type { RepositorySnapshot, WorkingTreeMutationOutcome } from "../../models.ts";

export interface ProjectFilesRepositoryLocation {
  readonly repositoryId: string;
  readonly path: string;
}

export interface CreatedFileStagingRuntime {
  canStage(workspacePath: string): boolean;
  stage(workspacePath: string): Promise<void>;
}

interface CreatedFileStagingPort {
  workspaceRoot(): string | null;
  snapshot(): RepositorySnapshot | null;
  beginTransition(): number;
  matches(generation: number, root: string): boolean;
  completeTransition(generation: number): void;
  stagePaths(root: string, paths: string[]): Promise<WorkingTreeMutationOutcome>;
  install(outcome: WorkingTreeMutationOutcome): string;
  scanUntracked(root: string, generation: number): void;
  failureMessage(): string;
}

export function createCreatedFileStagingRuntime(
  port: CreatedFileStagingPort,
): CreatedFileStagingRuntime {
  return {
    canStage(workspacePath) {
      const snapshot = port.snapshot();
      const location = resolveProjectFilesRepositoryLocation(
        workspacePath,
        port.workspaceRoot(),
        snapshot,
      );
      return Boolean(snapshot && location?.repositoryId === "." && location.path !== ".");
    },
    async stage(workspacePath) {
      const snapshot = port.snapshot();
      const location = resolveProjectFilesRepositoryLocation(
        workspacePath,
        port.workspaceRoot(),
        snapshot,
      );
      if (!snapshot || location?.repositoryId !== "." || location.path === ".") {
        throw new Error(port.failureMessage());
      }
      const generation = port.beginTransition();
      let pendingRoot: string | null = null;
      try {
        const outcome = await port.stagePaths(snapshot.root, [location.path]);
        if (!port.matches(generation, snapshot.root)) throw new Error(port.failureMessage());
        pendingRoot = port.install(outcome);
      } finally {
        port.completeTransition(generation);
      }
      if (pendingRoot && port.matches(generation, pendingRoot)) {
        port.scanUntracked(pendingRoot, generation);
      }
    },
  };
}

export function resolveProjectFilesRepositoryLocation(
  workspacePath: string,
  workspaceRoot: string | null,
  snapshot: RepositorySnapshot | null,
): ProjectFilesRepositoryLocation | null {
  if (!workspaceRoot) return null;
  const normalized = normalizePath(workspacePath);
  if (!snapshot) return { repositoryId: "workspace", path: normalized };
  const repositories = snapshot.repositoryRoots.filter((candidate) => {
    const relative = candidate.relativePath === "." ? "" : normalizePath(candidate.relativePath);
    return !relative || normalized === relative || normalized.startsWith(`${relative}/`);
  }).sort((left, right) => right.relativePath.length - left.relativePath.length);
  const repository = repositories[0];
  if (!repository) return null;
  const relative = repository.relativePath === "." ? "" : normalizePath(repository.relativePath);
  const path = relative ? normalized.slice(relative.length).replace(/^\/+/, "") : normalized;
  return { repositoryId: repository.id, path: path || "." };
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
}
