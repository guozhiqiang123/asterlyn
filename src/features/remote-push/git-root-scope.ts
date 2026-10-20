import type { BranchState, RemoteSummary, RepositorySnapshot } from "../../models.ts";

export function repositoryRemotes(
  snapshot: RepositorySnapshot,
  repositoryId: string,
): RemoteSummary[] {
  return snapshot.remotes.filter((remote) => (remote.repositoryId ?? ".") === repositoryId);
}

export function repositoryBranch(
  snapshot: RepositorySnapshot,
  repositoryId: string,
): BranchState | null {
  if (repositoryId === ".") return snapshot.branch;
  const branch = snapshot.branches.find((candidate) =>
    candidate.repositoryId === repositoryId && candidate.kind === "local" && candidate.current
  );
  if (!branch) return null;
  return {
    head: branch.name,
    oid: branch.oid,
    upstream: branch.upstream,
    upstreamRemote: branch.upstreamRemote ?? null,
    upstreamRef: branch.upstreamRef ?? null,
    ahead: branch.ahead ?? 0,
    behind: branch.behind ?? 0,
    detached: false,
    unborn: false,
  };
}

export function scopedRepositorySnapshot(
  snapshot: RepositorySnapshot,
  repositoryId: string,
): RepositorySnapshot {
  const branch = repositoryBranch(snapshot, repositoryId);
  return {
    ...snapshot,
    branch: branch ?? {
      head: null,
      oid: null,
      upstream: null,
      upstreamRemote: null,
      upstreamRef: null,
      ahead: 0,
      behind: 0,
      detached: true,
      unborn: false,
    },
    remotes: repositoryRemotes(snapshot, repositoryId),
  };
}

export function preferredPushRepository(snapshot: RepositorySnapshot): string {
  const roots = snapshot.repositoryRoots.length
    ? snapshot.repositoryRoots
    : [{ id: ".", relativePath: ".", displayName: ".", kind: "main" as const }];
  const pushable = roots.filter((root) => {
    const branch = repositoryBranch(snapshot, root.id);
    return branch?.head && repositoryRemotes(snapshot, root.id).some((remote) => remote.pushSupported);
  });
  return pushable.find((root) => (repositoryBranch(snapshot, root.id)?.ahead ?? 0) > 0)?.id ??
    pushable.find((root) => root.id === ".")?.id ??
    pushable[0]?.id ??
    ".";
}
