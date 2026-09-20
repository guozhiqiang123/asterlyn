import type {
  GitResetMode,
  GitResetPlan,
  RemoteMutationPlan,
  RemoteMutationRequest,
  RepositorySnapshot,
} from "./models";

export function demoPrepareRemoteMutation(
  snapshot: RepositorySnapshot,
  request: RemoteMutationRequest,
): RemoteMutationPlan {
  if (snapshot.operation) throw new Error("Finish the active Git operation first.");
  const name = request.name.trim();
  if (!/^(?![-.])[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error("Enter a valid remote name.");
  }
  const targetUrl = request.kind === "delete" ? null : request.url?.trim() ?? "";
  if (request.kind !== "delete" && !targetUrl) throw new Error("Enter a remote URL.");
  const source = request.sourceName
    ? snapshot.remotes.find((remote) => remote.name === request.sourceName)
    : null;
  if (request.kind === "add" && snapshot.remotes.some((remote) => remote.name === name)) {
    throw new Error("The remote name already exists.");
  }
  if (request.kind !== "add" && !source) throw new Error("The selected remote no longer exists.");
  if (
    request.kind === "edit" && name !== source?.name &&
    snapshot.remotes.some((remote) => remote.name === name)
  ) throw new Error("The new remote name already exists.");
  if (request.kind === "delete" && name !== source?.name) {
    throw new Error("The reviewed remote changed.");
  }
  const fields = [request.kind, source?.name ?? "", name, source?.url ?? "", targetUrl];
  return {
    repositoryRoot: snapshot.root,
    kind: request.kind,
    sourceName: source?.name ?? null,
    targetName: name,
    sourceUrl: source?.url ?? null,
    targetUrl,
    configurationToken: JSON.stringify([source?.name ?? "", source?.url ?? ""]),
    previewToken: JSON.stringify(fields),
  };
}

export function demoExecuteRemoteMutation(
  snapshot: RepositorySnapshot,
  plan: RemoteMutationPlan,
): RepositorySnapshot {
  const refreshed = demoPrepareRemoteMutation(snapshot, {
    kind: plan.kind,
    sourceName: plan.sourceName,
    name: plan.targetName,
    url: plan.targetUrl,
  });
  if (JSON.stringify(refreshed) !== JSON.stringify(plan)) {
    throw new Error("The reviewed remote plan is stale; prepare it again.");
  }
  const next = structuredClone(snapshot);
  if (plan.kind === "add") {
    next.remotes.push({
      name: plan.targetName,
      url: plan.targetUrl,
      fetchSupported: true,
      pushSupported: true,
    });
    next.remotes.sort((left, right) => left.name.localeCompare(right.name));
    return next;
  }
  const source = plan.sourceName!;
  if (plan.kind === "delete") {
    next.remotes = next.remotes.filter((remote) => remote.name !== source);
    next.branches = next.branches.filter((branch) => (
      branch.kind !== "remote" || !branch.name.startsWith(`${source}/`)
    ));
    for (const branch of next.branches) {
      if (branch.upstream?.startsWith(`${source}/`)) branch.upstream = null;
    }
    if (next.branch.upstreamRemote === source) {
      next.branch.upstream = null;
      next.branch.upstreamRemote = null;
      next.branch.upstreamRef = null;
    }
    return next;
  }
  const remote = next.remotes.find((candidate) => candidate.name === source)!;
  remote.name = plan.targetName;
  remote.url = plan.targetUrl;
  for (const branch of next.branches) {
    if (branch.kind === "remote" && branch.name.startsWith(`${source}/`)) {
      const suffix = branch.name.slice(source.length + 1);
      branch.name = `${plan.targetName}/${suffix}`;
      branch.fullName = `refs/remotes/${plan.targetName}/${suffix}`;
    }
    if (branch.upstream?.startsWith(`${source}/`)) {
      branch.upstream = `${plan.targetName}/${branch.upstream.slice(source.length + 1)}`;
    }
  }
  if (next.branch.upstreamRemote === source) {
    next.branch.upstreamRemote = plan.targetName;
    next.branch.upstream = next.branch.upstream
      ? `${plan.targetName}/${next.branch.upstream.slice(source.length + 1)}`
      : null;
  }
  return next;
}

export function demoPrepareGitReset(
  snapshot: RepositorySnapshot,
  targetOid: string,
): GitResetPlan {
  if (!snapshot.branch.head || !snapshot.branch.oid || snapshot.branch.detached || snapshot.branch.unborn) {
    throw new Error("A checked-out local branch with an existing HEAD is required.");
  }
  if (snapshot.operation) throw new Error("Finish the active Git operation first.");
  if (targetOid === snapshot.branch.oid) throw new Error("Select a commit other than HEAD.");
  if (!currentBranchContains(snapshot, targetOid)) {
    throw new Error("The selected commit is not contained in the current branch.");
  }
  const startHeadRef = `refs/heads/${snapshot.branch.head}`;
  return {
    repositoryRoot: snapshot.root,
    startHeadRef,
    startHeadOid: snapshot.branch.oid,
    targetOid,
    previewToken: JSON.stringify([startHeadRef, snapshot.branch.oid, targetOid]),
  };
}

export function demoExecuteGitReset(
  snapshot: RepositorySnapshot,
  plan: GitResetPlan,
  _mode: GitResetMode,
): RepositorySnapshot {
  const refreshed = demoPrepareGitReset(snapshot, plan.targetOid);
  if (JSON.stringify(refreshed) !== JSON.stringify(plan)) {
    throw new Error("The reviewed reset plan is stale; prepare it again.");
  }
  const next = structuredClone(snapshot);
  next.branch.oid = plan.targetOid;
  const current = next.branches.find((branch) => branch.repositoryId === "." && branch.current);
  if (current) current.oid = plan.targetOid;
  return next;
}

function currentBranchContains(snapshot: RepositorySnapshot, targetOid: string): boolean {
  const commits = new Map(snapshot.commits.map((commit) => [commit.oid, commit]));
  const seen = new Set<string>();
  let oid: string | undefined | null = snapshot.branch.oid;
  while (oid && !seen.has(oid)) {
    if (oid === targetOid) return true;
    seen.add(oid);
    oid = commits.get(oid)?.parents[0];
  }
  return false;
}
