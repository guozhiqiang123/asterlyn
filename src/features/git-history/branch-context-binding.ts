import type { BranchSummary, RepositorySnapshot } from "../../models.ts";
import type { WorkspaceTargetIdentity } from "../../application/workbench-navigation.ts";
import { branchKey } from "../../workbench/history-identity.ts";
import { effectiveHistoryRootIds } from "../../workbench/history-root-selection.ts";
import { matchingLogicalBranches } from "../../workbench/git-presentation.ts";
import {
  DelegatedContextBinding,
  type DelegatedContextRequest,
} from "../../shared/context-menu/delegated-context-binding.ts";

export interface BranchContextTarget extends WorkspaceTargetIdentity {
  readonly repositoryRevision: number;
  readonly key: string;
  readonly branch: BranchSummary;
  readonly matches: readonly BranchSummary[];
}

export class BranchContextBinding {
  private readonly binding: DelegatedContextBinding<BranchContextTarget>;

  constructor(
    root: HTMLElement,
    current: () => {
      readonly snapshot: RepositorySnapshot | null;
      readonly workspaceGeneration: number;
      readonly repositoryRevision: number;
      readonly selectedRepositoryIds: ReadonlySet<string>;
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
              context.repositoryRevision,
              context.selectedRepositoryIds,
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
  repositoryRevision: number,
  selectedRepositoryIds: ReadonlySet<string>,
  key: string,
): BranchContextTarget | null {
  const branch = snapshot?.branches.find((candidate) => branchKey(candidate) === key);
  if (!snapshot || !branch || branch.kind === "tag") return null;
  const activeRoots = effectiveHistoryRootIds(
    snapshot.repositoryRoots.map((root) => root.id),
    selectedRepositoryIds,
  );
  const matches = matchingLogicalBranches(snapshot.branches, branch, activeRoots);
  return {
    workspaceRoot: snapshot.root,
    workspaceGeneration,
    repositoryRevision,
    key,
    branch: { ...branch },
    matches: matches.map((candidate) => ({ ...candidate })),
  };
}

export function branchContextTargetIsCurrent(
  target: BranchContextTarget,
  snapshot: RepositorySnapshot | null,
  workspaceGeneration: number,
  repositoryRevision: number,
  selectedRepositoryIds: ReadonlySet<string>,
): boolean {
  if (
    !snapshot || snapshot.root !== target.workspaceRoot ||
    workspaceGeneration !== target.workspaceGeneration ||
    repositoryRevision !== target.repositoryRevision
  ) return false;
  const refreshed = resolveBranchContextTarget(
    snapshot,
    workspaceGeneration,
    repositoryRevision,
    selectedRepositoryIds,
    target.key,
  );
  if (!refreshed || refreshed.matches.length !== target.matches.length) return false;
  const captured = new Map(target.matches.map((branch) => [branchKey(branch), branch]));
  return refreshed.matches.every((branch) => {
    const before = captured.get(branchKey(branch));
    return Boolean(
      before && before.oid === branch.oid && before.kind === branch.kind &&
      before.current === branch.current && before.upstream === branch.upstream,
    );
  });
}
