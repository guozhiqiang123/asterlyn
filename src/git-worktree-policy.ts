import type { FileChange } from "./models.ts";

export function isSubmoduleWorktreeOnlyChange(change: FileChange): boolean {
  return change.submodule && !change.conflicted &&
    change.indexStatus === "unmodified" && change.worktreeStatus === "modified";
}

export function repositoryMutationChanges(
  changes: readonly FileChange[],
  repositoryId = ".",
): FileChange[] {
  return changes.filter(
    (change) => (change.repositoryId || ".") === repositoryId && !isSubmoduleWorktreeOnlyChange(change),
  );
}
