import type { RepositoryMutationOutcome, RepositoryStateSlice } from "../models.ts";

export interface RepositoryReconciliationPlan {
  readonly slices: ReadonlySet<RepositoryStateSlice>;
  readonly updateRemote: boolean;
  readonly updateWorkingTree: boolean;
  readonly updateHistory: boolean;
  readonly reconcileOpenDocuments: boolean;
  readonly reloadWorkspaceCatalog: boolean;
  readonly reconcileOperation: boolean;
}

export function repositoryReconciliationPlan(
  outcome: RepositoryMutationOutcome,
): RepositoryReconciliationPlan {
  const slices = new Set(outcome.invalidatedSlices);
  return {
    slices,
    updateRemote: slices.has("head") || slices.has("refs"),
    updateWorkingTree: slices.has("workingTree"),
    updateHistory: slices.has("history"),
    reconcileOpenDocuments: slices.has("openDocuments") || slices.has("workingTree"),
    reloadWorkspaceCatalog: slices.has("workspaceCatalog"),
    reconcileOperation: slices.has("operation"),
  };
}
