import type { BranchSummary, RepositorySnapshot } from "../../models.ts";
import type { WorkspaceTargetIdentity } from "../../application/workbench-navigation.ts";
import { branchKey } from "../../workbench/history-identity.ts";
import {
  DelegatedContextBinding,
  type DelegatedContextRequest,
} from "../../shared/context-menu/delegated-context-binding.ts";

export interface BranchContextTarget extends WorkspaceTargetIdentity {
  readonly key: string;
  readonly branch: BranchSummary;
}

export class BranchContextBinding {
  private readonly binding: DelegatedContextBinding<BranchContextTarget>;

  constructor(
    root: HTMLElement,
    current: () => {
      readonly snapshot: RepositorySnapshot | null;
      readonly workspaceGeneration: number;
    },
    open: (request: DelegatedContextRequest<BranchContextTarget>) => boolean,
  ) {
    this.binding = new DelegatedContextBinding(root, {
      selector: "[data-branch-key]",
      resolve: (trigger) => {
        const key = trigger.dataset.branchKey;
        const context = current();
        return key
          ? resolveBranchContextTarget(
              context.snapshot,
              context.workspaceGeneration,
              key,
            )
          : null;
      },
      open,
    });
  }

  dispose(): void {
    this.binding.dispose();
  }
}

export function resolveBranchContextTarget(
  snapshot: RepositorySnapshot | null,
  workspaceGeneration: number,
  key: string,
): BranchContextTarget | null {
  const branch = snapshot?.branches.find((candidate) => branchKey(candidate) === key);
  return snapshot && branch
    ? {
        workspaceRoot: snapshot.root,
        workspaceGeneration,
        key,
        branch: { ...branch },
      }
    : null;
}
