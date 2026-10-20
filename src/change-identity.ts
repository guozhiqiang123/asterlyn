import type { FileChange } from "./models.ts";

/**
 * Working-tree paths are only unique inside their owning Git repository. Keep the repository
 * identity opaque in UI state instead of attempting to recover it from a displayed path.
 */
export function fileChangeKey(change: Pick<FileChange, "repositoryId" | "path">): string {
  return JSON.stringify([change.repositoryId || ".", change.path]);
}

export function sameFileChangeIdentity(
  left: Pick<FileChange, "repositoryId" | "path">,
  right: Pick<FileChange, "repositoryId" | "path">,
): boolean {
  return (left.repositoryId || ".") === (right.repositoryId || ".") && left.path === right.path;
}

export function findFileChange(
  changes: readonly FileChange[],
  repositoryId: string,
  path: string,
): FileChange | null {
  return changes.find(
    (change) => (change.repositoryId || ".") === repositoryId && change.path === path,
  ) ?? null;
}

export function findFileChangeByKey(
  changes: readonly FileChange[],
  key: string,
): FileChange | null {
  return changes.find((change) => fileChangeKey(change) === key) ?? null;
}

export function changeWorkspacePath(change: FileChange): string {
  return change.workspacePath || change.path;
}
