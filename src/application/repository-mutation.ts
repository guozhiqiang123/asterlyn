import type { RepositoryMutationOutcome, RepositoryStateSlice } from "../models.ts";

export interface RepositoryReconciliationPlan {
  readonly slices: ReadonlySet<RepositoryStateSlice>;
  readonly updateRemote: boolean;
  readonly clearBranchSelection: boolean;
  readonly updateWorkingTree: boolean;
  readonly updateHistory: boolean;
  readonly reconcileOpenDocuments: boolean;
  readonly reloadWorkspaceCatalog: boolean;
  readonly reconcileOperation: boolean;
}

export function repositoryReconciliationPlan(
  outcome: { invalidatedSlices: RepositoryStateSlice[] },
): RepositoryReconciliationPlan {
  const slices = new Set(outcome.invalidatedSlices);
  return {
    slices,
    // Remote command policy also depends on worktree cleanliness, untracked scan state,
    // and an active Git operation. Its controller must follow those canonical slices.
    updateRemote: slices.has("head") ||
      slices.has("refs") ||
      slices.has("workingTree") ||
      slices.has("operation"),
    clearBranchSelection: slices.has("head") || slices.has("refs"),
    updateWorkingTree: slices.has("workingTree"),
    updateHistory: slices.has("history"),
    reconcileOpenDocuments: slices.has("openDocuments") || slices.has("workingTree"),
    reloadWorkspaceCatalog: slices.has("workspaceCatalog"),
    reconcileOperation: slices.has("operation"),
  };
}

export function remoteOutcomeNeedsUntrackedScan(
  outcome: RepositoryMutationOutcome,
): boolean {
  return outcome.snapshot.untrackedState === "pending" ||
    outcome.invalidatedSlices.includes("workingTree");
}
