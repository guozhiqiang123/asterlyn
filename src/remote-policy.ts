import type { RemoteSummary, RepositorySnapshot } from "./models";

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

  return {
    selectedRemote,
    fetch: fetchState(snapshot, selectedRemote),
    pull: pullState(snapshot, selectedRemote),
    push: pushState(snapshot, selectedRemote),
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
  return ready("Fetch", `Refresh all standard branch-tracking refs from ${remote.name}.`);
}

function pullState(
  snapshot: RepositorySnapshot,
  remote: RemoteSummary | null,
): RemoteActionState {
  const branch = snapshot.branch;
  if (!branch.head || branch.detached || branch.unborn) {
    return blocked("Update", "A checked-out branch with a commit is required.");
  }
  if (snapshot.operation) {
    return blocked("Update", `Finish the active ${snapshot.operation} operation first.`);
  }
  if (!branch.upstreamRemote || !branch.upstreamRef) {
    return blocked("Update", "Publish the branch or configure a supported upstream first.");
  }
  if (!remote) return blocked("Update", "Select the current branch's upstream remote.");
  if (remote.name !== branch.upstreamRemote) {
    return blocked(
      "Update blocked",
      `Select ${branch.upstreamRemote}, the configured upstream for this branch.`,
    );
  }
  if (!remote.fetchSupported) {
    return blocked("Update blocked", "The upstream uses an unsupported fetch mapping.");
  }
  if (branch.ahead > 0 && branch.behind > 0) {
    return blocked("Update blocked", "The branch has diverged; merge or rebase explicitly.");
  }
  if (snapshot.untrackedState === "pending") {
    return blocked("Update blocked", "Wait for the complete worktree scan.");
  }
  if (snapshot.untrackedState === "failed") {
    return blocked("Update blocked", "Refresh after the worktree scan failure.");
  }
  if (snapshot.changes.length > 0) {
    return blocked("Update blocked", "Commit, stash, or remove local changes first.");
  }
  if (branch.behind > 0 && branch.ahead === 0) {
    return ready("Update", `Fast-forward by ${branch.behind} upstream commit${branch.behind === 1 ? "" : "s"}.`);
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
  if (branch.upstreamRemote && remote.name !== branch.upstreamRemote) {
    return ready(
      "Review Push",
      `Review the same-named branch on ${remote.name}. A successful Push keeps ${branch.upstreamRemote} as the configured upstream.`,
    );
  }
  if (!branch.upstreamRemote) {
    return ready("Publish branch", `Create the same-named branch on ${remote.name}.`);
  }
  if (branch.behind > 0) {
    return ready(
      "Review Push",
      "The branch is behind or diverged. Ordinary Push will remain blocked in review; Force Push with Lease is available only as an explicit choice.",
    );
  }
  if (branch.ahead > 0) {
    return ready("Push", `Send ${branch.ahead} commit${branch.ahead === 1 ? "" : "s"} to ${remote.name}.`);
  }
  return ready("Review Push", "No branch commits are pending; open review to inspect optional tags.");
}

function ready(label: string, detail: string): RemoteActionState {
  return { enabled: true, label, detail };
}

function blocked(label: string, detail: string): RemoteActionState {
  return { enabled: false, label, detail };
}
