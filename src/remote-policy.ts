import type { RemoteSummary, RepositorySnapshot } from "./models";

export interface RemoteActionState {
  enabled: boolean;
  label: string;
  detail: string;
}

export interface RemotePolicy {
  selectedRemote: RemoteSummary | null;
  pushRemote: RemoteSummary | null;
  source: string | null;
  destination: string | null;
  fetch: RemoteActionState;
  pull: RemoteActionState;
  push: RemoteActionState;
}

export function preferredRemote(
  snapshot: RepositorySnapshot,
  selectedName: string | null,
): string | null {
  const names = new Set(snapshot.remotes.map((remote) => remote.name));
  if (selectedName && names.has(selectedName)) return selectedName;
  if (snapshot.branch.upstreamRemote && names.has(snapshot.branch.upstreamRemote)) {
    return snapshot.branch.upstreamRemote;
  }
  if (names.has("origin")) return "origin";
  return snapshot.remotes[0]?.name ?? null;
}

export function remotePolicy(
  snapshot: RepositorySnapshot,
  selectedName: string | null,
): RemotePolicy {
  const selectedRemote =
    snapshot.remotes.find((remote) => remote.name === selectedName) ?? null;
  const pushRemoteName = snapshot.branch.upstreamRemote ?? selectedRemote?.name ?? null;
  const pushRemote =
    snapshot.remotes.find((remote) => remote.name === pushRemoteName) ?? null;
  const source = snapshot.branch.head
    ? `refs/heads/${snapshot.branch.head}`
    : null;
  const destination = snapshot.branch.upstreamRef ?? source;

  return {
    selectedRemote,
    pushRemote,
    source,
    destination,
    fetch: fetchState(snapshot, selectedRemote),
    pull: pullState(snapshot),
    push: pushState(snapshot, pushRemote),
  };
}

function fetchState(
  snapshot: RepositorySnapshot,
  remote: RemoteSummary | null,
): RemoteActionState {
  if (snapshot.operation) {
    return blocked("Fetch", `Finish the active ${snapshot.operation} operation first.`);
  }
  if (!remote) return blocked("Fetch", "Select a configured remote.");
  if (!remote.fetchSupported) {
    return blocked("Fetch blocked", "This remote uses an unsupported fetch mapping.");
  }
  return ready("Fetch", `Refresh branch-tracking refs from ${remote.name}.`);
}

function pullState(snapshot: RepositorySnapshot): RemoteActionState {
  const branch = snapshot.branch;
  if (!branch.head || branch.detached || branch.unborn) {
    return blocked("Pull", "A checked-out branch with a commit is required.");
  }
  if (snapshot.operation) {
    return blocked("Pull", `Finish the active ${snapshot.operation} operation first.`);
  }
  if (!branch.upstreamRemote || !branch.upstreamRef) {
    return blocked("Pull", "Publish the branch or configure a supported upstream first.");
  }
  const upstream = snapshot.remotes.find(
    (remote) => remote.name === branch.upstreamRemote,
  );
  if (!upstream?.fetchSupported) {
    return blocked("Pull blocked", "The upstream uses an unsupported fetch mapping.");
  }
  if (branch.ahead > 0 && branch.behind > 0) {
    return blocked("Pull blocked", "The branch has diverged; merge or rebase explicitly.");
  }
  if (snapshot.untrackedState === "pending") {
    return blocked("Pull blocked", "Wait for the complete worktree scan.");
  }
  if (snapshot.untrackedState === "failed") {
    return blocked("Pull blocked", "Refresh after the worktree scan failure.");
  }
  if (snapshot.changes.length > 0) {
    return blocked("Pull blocked", "Commit, stash, or remove local changes first.");
  }
  if (branch.behind > 0 && branch.ahead === 0) {
    return ready("Pull fast-forward", `Apply ${branch.behind} upstream commit${branch.behind === 1 ? "" : "s"}.`);
  }
  return blocked("Up to date", "No upstream commits need to be pulled.");
}

function pushState(
  snapshot: RepositorySnapshot,
  remote: RemoteSummary | null,
): RemoteActionState {
  const branch = snapshot.branch;
  if (!branch.head || branch.detached || branch.unborn) {
    return blocked("Push", "A checked-out branch with a commit is required.");
  }
  if (snapshot.operation) {
    return blocked("Push", `Finish the active ${snapshot.operation} operation first.`);
  }
  if (!remote) return blocked("Push", "Select a configured remote.");
  if (!remote.pushSupported) {
    return blocked("Push blocked", "This remote is mirrored or uses an unsupported mapping.");
  }
  if (branch.behind > 0) {
    return blocked("Push blocked", "Fetch and reconcile upstream commits first.");
  }
  if (!branch.upstreamRemote) {
    return ready("Publish branch", `Create the same-named branch on ${remote.name}.`);
  }
  if (branch.ahead > 0) {
    return ready("Push", `Send ${branch.ahead} commit${branch.ahead === 1 ? "" : "s"} to ${remote.name}.`);
  }
  return blocked("Up to date", "No local commits need to be pushed.");
}

function ready(label: string, detail: string): RemoteActionState {
  return { enabled: true, label, detail };
}

function blocked(label: string, detail: string): RemoteActionState {
  return { enabled: false, label, detail };
}
