import type { RemoteSummary, RepositorySnapshot } from "./models";
import { repositoryMutationChanges } from "./git-worktree-policy.ts";
import { DEFAULT_LOCALIZATION, type Localization } from "./localization/localization.ts";
import { scopedRepositorySnapshot } from "./features/remote-push/git-root-scope.ts";

export interface RemoteActionState {
  enabled: boolean;
  label: string;
  detail: string;
}

export interface RemotePolicy {
  selectedRemote: RemoteSummary | null;
  fetch: RemoteActionState;
  pull: RemoteActionState;
  push: RemoteActionState;
}

export function preferredRemote(
  snapshot: RepositorySnapshot,
  selectedName: string | null,
  repositoryId = ".",
): string | null {
  const scoped = scopedRepositorySnapshot(snapshot, repositoryId);
  const names = new Set(scoped.remotes.map((remote) => remote.name));
  if (selectedName && names.has(selectedName)) return selectedName;
  if (scoped.branch.upstreamRemote && names.has(scoped.branch.upstreamRemote)) {
    return scoped.branch.upstreamRemote;
  }
  if (names.has("origin")) return "origin";
  return scoped.remotes[0]?.name ?? null;
}

export function requiresRemoteConfiguration(snapshot: RepositorySnapshot, repositoryId = "."): boolean {
  return scopedRepositorySnapshot(snapshot, repositoryId).remotes.length === 0;
}

export function remotePolicy(
  snapshot: RepositorySnapshot,
  selectedName: string | null,
  localization: Localization = DEFAULT_LOCALIZATION,
  repositoryId = ".",
): RemotePolicy {
  const scoped = scopedRepositorySnapshot(snapshot, repositoryId);
  const selectedRemote =
    scoped.remotes.find((remote) => remote.name === selectedName) ?? null;

  return {
    selectedRemote,
    fetch: fetchState(scoped, selectedRemote, localization),
    pull: pullState(scoped, selectedRemote, localization),
    push: pushState(scoped, selectedRemote, localization),
  };
}

function fetchState(
  snapshot: RepositorySnapshot,
  remote: RemoteSummary | null,
  localization: Localization,
): RemoteActionState {
  const copy = localization.catalog.remote.policy;
  if (snapshot.operation) {
    return blocked(localization.catalog.remote.actionNames.fetch, copy.finishActive(localization.catalog.gitOperations.names[snapshot.operation.kind]));
  }
  if (!remote) return blocked(localization.catalog.remote.actionNames.fetch, copy.selectConfigured);
  if (!remote.fetchSupported) {
    return blocked(localization.catalog.remote.actionNames.fetch, copy.unsupportedFetch);
  }
  return ready(localization.catalog.remote.actionNames.fetch, copy.refreshRefs(remote.name));
}

function pullState(
  snapshot: RepositorySnapshot,
  remote: RemoteSummary | null,
  localization: Localization,
): RemoteActionState {
  const copy = localization.catalog.remote.policy;
  const label = localization.catalog.remote.actionNames.pull;
  const branch = snapshot.branch;
  if (!branch.head || branch.detached || branch.unborn) {
    return blocked(label, copy.requireBranch);
  }
  if (snapshot.operation) {
    return blocked(label, copy.finishActive(localization.catalog.gitOperations.names[snapshot.operation.kind]));
  }
  if (!branch.upstreamRemote || !branch.upstreamRef) {
    return blocked(label, copy.publishOrConfigure);
  }
  if (!remote) return blocked(label, copy.selectUpstream);
  if (remote.name !== branch.upstreamRemote) {
    return blocked(
      label,
      copy.selectNamedUpstream(branch.upstreamRemote),
    );
  }
  if (!remote.fetchSupported) {
    return blocked(label, copy.unsupportedUpstream);
  }
  if (snapshot.untrackedState === "pending") {
    return blocked(label, copy.waitForScan);
  }
  if (snapshot.untrackedState === "failed") {
    return blocked(label, copy.refreshAfterScanFailure);
  }
  if (repositoryMutationChanges(snapshot.changes).length > 0) {
    return blocked(label, copy.clearLocalChanges);
  }
  if (branch.behind > 0) {
    return ready(
      label,
      branch.ahead > 0
        ? copy.reviewDivergence(branch.ahead, branch.behind)
        : copy.fastForward(branch.behind),
    );
  }
  return ready(label, copy.checkUpstream);
}

function pushState(
  snapshot: RepositorySnapshot,
  remote: RemoteSummary | null,
  localization: Localization,
): RemoteActionState {
  const copy = localization.catalog.remote.policy;
  const label = localization.catalog.remote.actionNames.push;
  const branch = snapshot.branch;
  if (!branch.head || branch.detached || branch.unborn) {
    return blocked(label, copy.requireBranch);
  }
  if (snapshot.operation) {
    return blocked(label, copy.finishActive(localization.catalog.gitOperations.names[snapshot.operation.kind]));
  }
  if (!remote) return blocked(label, copy.selectConfigured);
  if (!remote.pushSupported) {
    return blocked(label, copy.unsupportedPush);
  }
  if (branch.upstreamRemote && remote.name !== branch.upstreamRemote) {
    return ready(
      label,
      copy.reviewOtherRemote(remote.name, branch.upstreamRemote),
    );
  }
  if (!branch.upstreamRemote) {
    return ready(copy.publishBranch, copy.createRemoteBranch(remote.name));
  }
  if (branch.behind > 0) {
    return ready(
      label,
      copy.behindOrDiverged,
    );
  }
  if (branch.ahead > 0) {
    return ready(label, copy.sendCommits(branch.ahead, remote.name));
  }
  return ready(label, copy.noPendingCommits);
}

function ready(label: string, detail: string): RemoteActionState {
  return { enabled: true, label, detail };
}

function blocked(label: string, detail: string): RemoteActionState {
  return { enabled: false, label, detail };
}
