import type { FileChange } from "./models.ts";

export function isSubmoduleWorktreeOnlyChange(change: FileChange): boolean {
  return change.submodule && !change.conflicted &&
    change.indexStatus === "unmodified" && change.worktreeStatus === "modified";
}

export function topLevelMutationChanges(
  changes: readonly FileChange[],
): FileChange[] {
  return changes.filter(
    (change) => (change.repositoryId || ".") === "." && !isSubmoduleWorktreeOnlyChange(change),
  );
}
