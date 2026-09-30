import type { BranchSummary } from "../../models.ts";

export function historyReferencesVersion(branches: readonly BranchSummary[]): string {
  return branches
    .map((branch) => `${branch.repositoryId}\u0000${branch.fullName}\u0000${branch.oid}\u0000${branch.linkedWorktreePath ?? ""}`)
    .sort()
    .join("\u0001");
}
