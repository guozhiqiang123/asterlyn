import type { Localization } from "../localization/localization.ts";
import { repositoryMutationChanges } from "../git-worktree-policy.ts";
import type { BranchMutationKind, BranchSummary, RepositorySnapshot } from "../models.ts";
import { remotePolicy } from "../remote-policy.ts";
import type { WindowSession } from "./window-session.ts";

export async function recoverPendingRemoteAction(
  kind: "pull" | "push",
  session: WindowSession,
  selectedRemote: string | null,
  localization: Localization,
  busy: boolean,
): Promise<boolean> {
  const snapshot = session.repository.state.snapshot;
  if (
    kind !== "pull" ||
    busy ||
    !snapshot ||
    snapshot.untrackedState !== "pending" ||
    remotePolicy(snapshot, selectedRemote, localization).pull.detail !==
      localization.catalog.remote.policy.waitForScan
  ) return true;

  const generation = session.generation;
  await session.ensureUntrackedScan(snapshot.root, generation, true, "manualRefresh");
  return session.matches(generation, snapshot.root);
}

export async function recoverPendingBranchMutation(
  session: WindowSession,
): Promise<boolean> {
  const snapshot = session.repository.state.snapshot;
  if (!snapshot || snapshot.untrackedState !== "pending") return true;

  const repositoryRoot = snapshot.root;
  const generation = session.generation;
  await session.ensureUntrackedScan(repositoryRoot, generation, true, "manualRefresh");
  const current = session.repository.state.snapshot;
  return session.matches(generation, repositoryRoot) &&
    current?.root === repositoryRoot &&
    current.untrackedState === "complete";
}

export type PreparedBranchMutation =
  | { readonly kind: "ready"; readonly root: string; readonly branch: BranchSummary }
  | { readonly kind: "blocked"; readonly snapshot: RepositorySnapshot }
  | { readonly kind: "stale" };

export async function prepareBranchMutation(
  session: WindowSession,
  kind: BranchMutationKind,
  branch: BranchSummary,
): Promise<PreparedBranchMutation> {
  const requiresCleanCheck = kind === "switch" || kind === "checkoutRemote" || kind === "create";
  if (requiresCleanCheck && !await recoverPendingBranchMutation(session)) {
    const snapshot = session.repository.state.snapshot;
    return snapshot ? { kind: "blocked", snapshot } : { kind: "stale" };
  }
  const snapshot = session.repository.state.snapshot;
  if (!snapshot) return { kind: "stale" };
  if (
    requiresCleanCheck &&
    (repositoryMutationChanges(snapshot.changes, branch.repositoryId).length > 0 ||
      snapshot.untrackedState !== "complete")
  ) return { kind: "blocked", snapshot };
  const currentBranch = snapshot.branches.find((candidate) =>
    candidate.repositoryId === branch.repositoryId && candidate.fullName === branch.fullName
  );
  return currentBranch
    ? { kind: "ready", root: snapshot.root, branch: currentBranch }
    : { kind: "stale" };
}

export function branchSafety(
  snapshot: RepositorySnapshot,
  localization: Localization,
  repositoryId = ".",
): { ready: boolean; message: string; blockers: string[] } {
  const blockers = repositoryMutationChanges(snapshot.changes, repositoryId).map((change) => change.path);
  if (blockers.length > 0) return {
    ready: false,
    message: localization.catalog.history.changedPathsBlock(blockers.length),
    blockers,
  };
  if (snapshot.untrackedState === "pending") return {
    ready: false,
    message: localization.catalog.history.checkingUntrackedForBranch,
    blockers: [],
  };
  if (snapshot.untrackedState === "failed") return {
    ready: false,
    message: localization.catalog.history.untrackedCheckFailedForBranch,
    blockers: [],
  };
  return {
    ready: true,
    message: localization.catalog.history.cleanWorktreeVerified,
    blockers: [],
  };
}
