import type { BranchMutationPlan, RepositorySnapshot } from "./models.ts";

export function demoRemoteDeletionTarget(
  snapshot: RepositorySnapshot,
  upstream: string | null,
): NonNullable<BranchMutationPlan["remoteDeletion"]> {
  const [remote, ...branchParts] = upstream?.split("/") ?? [];
  const branch = branchParts.join("/");
  const trackingFullName = remote && branch ? `refs/remotes/${remote}/${branch}` : "";
  const tracking = snapshot.branches.find((candidate) => (
    candidate.repositoryId === "." && candidate.fullName === trackingFullName
  ));
  if (!remote || !branch || !tracking) {
    throw new Error("The selected local branch has no last-fetched remote upstream to delete.");
  }
  return {
    remote,
    branchFullName: `refs/heads/${branch}`,
    trackingFullName,
    oid: tracking.oid,
  };
}
