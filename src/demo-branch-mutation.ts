import type { BranchMutationPlan, BranchMutationRequest, RepositorySnapshot } from "./models.ts";

export function demoSwitchBranch(
  snapshot: RepositorySnapshot,
  targetFullName: string,
): RepositorySnapshot {
  ensureDemoBranchMutationIsSafe(snapshot);
  const next = structuredClone(snapshot);
  const target = next.branches.find(
    (branch) => branch.kind === "local" && branch.fullName === targetFullName,
  );
  if (!target) throw new Error("Select an existing local branch.");
  if (target.current) throw new Error(`${target.name} is already checked out.`);
  for (const branch of next.branches) branch.current = branch === target;
  next.branch = {
    head: target.name,
    oid: target.oid,
    upstream: target.upstream,
    upstreamRemote: target.upstream ? "origin" : null,
    upstreamRef: target.upstream
      ? `refs/heads/${target.upstream.split("/").slice(1).join("/")}`
      : null,
    ahead: 0,
    behind: 0,
    detached: false,
    unborn: false,
  };
  return next;
}

export function demoCreateBranch(
  snapshot: RepositorySnapshot,
  name: string,
): RepositorySnapshot {
  ensureDemoBranchMutationIsSafe(snapshot);
  const normalized = name.trim();
  if (!/^(?![-.])(?!.*\.\.)(?!.*@\{)[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(normalized)) {
    throw new Error("Enter a valid literal local branch name.");
  }
  const fullName = `refs/heads/${normalized}`;
  if (snapshot.branches.some((branch) => branch.fullName === fullName)) {
    throw new Error(`${normalized} already exists.`);
  }
  const next = structuredClone(snapshot);
  for (const branch of next.branches) branch.current = false;
  const tip = next.commits[0];
  next.branches.unshift({
    repositoryId: ".",
    fullName,
    name: normalized,
    oid: next.branch.oid ?? tip?.oid ?? "0".repeat(40),
    current: true,
    kind: "local",
    upstream: null,
    tracking: null,
    committedAt: tip?.authoredAt ?? Math.floor(Date.now() / 1000),
    subject: tip?.subject ?? "Unborn branch",
    linkedWorktreePath: null,
  });
  next.branch = {
    ...next.branch,
    head: normalized,
    upstream: null,
    upstreamRemote: null,
    upstreamRef: null,
    ahead: 0,
    behind: 0,
    detached: false,
  };
  return next;
}

export function demoPrepareBranchMutation(
  snapshot: RepositorySnapshot,
  request: BranchMutationRequest,
): BranchMutationPlan {
  if (!snapshot.branch.head || !snapshot.branch.oid || snapshot.branch.detached || snapshot.branch.unborn) {
    throw new Error("A checked-out local branch with an existing HEAD is required.");
  }
  if (snapshot.operation) throw new Error("Finish the active Git operation first.");
  const branch = snapshot.branches.find((candidate) =>
    candidate.repositoryId === "." && candidate.fullName === request.sourceFullName
  );
  const commit = snapshot.commits.find((candidate) =>
    candidate.repositoryId === "." && candidate.oid === request.sourceOid
  );
  const source = request.kind === "create" && request.sourceFullName === request.sourceOid
    ? {
        kind: "commit" as const,
        name: request.sourceOid.slice(0, 12),
        oid: commit?.oid ?? request.sourceOid,
        upstream: null,
      }
    : branch;
  if (!source || source.oid !== request.sourceOid) {
    throw new Error("The selected branch or commit changed; prepare it again.");
  }
  if (["switch", "rename", "delete", "removeWorktree"].includes(request.kind) && source.kind !== "local") {
    throw new Error("Select an existing local branch.");
  }
  if (request.kind === "checkoutRemote" && source.kind !== "remote") {
    throw new Error("Select an existing remote-tracking branch.");
  }
  if (source.kind === "tag") {
    throw new Error("Select a local branch, remote branch, or exact commit.");
  }
  if (["switch", "create", "checkoutRemote"].includes(request.kind)) {
    ensureDemoBranchMutationIsSafe(snapshot);
  }
  const startHeadRef = `refs/heads/${snapshot.branch.head}`;
  if (request.kind === "switch" && request.sourceFullName === startHeadRef) {
    throw new Error("The selected branch is already checked out.");
  }
  if (request.kind === "delete" && request.sourceFullName === startHeadRef) {
    throw new Error("The checked-out branch cannot be deleted.");
  }
  if (request.kind === "removeWorktree" && request.sourceFullName === startHeadRef) {
    throw new Error("The current worktree cannot delete itself.");
  }
  const worktreePath = request.kind === "removeWorktree"
    ? "linkedWorktreePath" in source ? source.linkedWorktreePath : null
    : null;
  if (request.kind === "removeWorktree" && !worktreePath) {
    throw new Error("The selected branch is no longer checked out in a linked Git worktree.");
  }
  let newName: string | null = null;
  let targetFullName: string | null = null;
  if (["create", "checkoutRemote", "rename"].includes(request.kind)) {
    newName = request.newName?.trim() ?? "";
    if (!/^(?![-.])(?!.*\.\.)(?!.*@\{)[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(newName)) {
      throw new Error("Enter a valid literal local branch name.");
    }
    targetFullName = `refs/heads/${newName}`;
    if (targetFullName === request.sourceFullName || snapshot.branches.some(
      (candidate) => candidate.fullName === targetFullName,
    )) throw new Error(`${newName} already exists.`);
  }
  const mergedIntoCurrent = request.kind === "delete"
    ? historyFromOid(snapshot, snapshot.branch.oid).some((candidate) => candidate.oid === source.oid)
    : null;
  if (request.kind === "delete" && !mergedIntoCurrent) {
    throw new Error("Only a branch already merged into the current HEAD can be deleted.");
  }
  if (request.deleteRemote && request.kind !== "delete") {
    throw new Error("Remote deletion is available only while deleting a local branch.");
  }
  const remoteDeletion = request.deleteRemote
    ? demoRemoteDeletionTarget(snapshot, source.upstream)
    : null;
  const fields = [
    request.kind, request.sourceFullName, source.oid, source.kind, newName ?? "", worktreePath ?? "", startHeadRef,
    snapshot.branch.oid, source.upstream ?? "", mergedIntoCurrent ? "merged" : "",
    request.deleteRemote ? "delete-remote" : "local-only", remoteDeletion?.remote ?? "",
    remoteDeletion?.branchFullName ?? "", remoteDeletion?.trackingFullName ?? "",
    remoteDeletion?.oid ?? "",
  ];
  return {
    repositoryRoot: snapshot.root,
    kind: request.kind,
    sourceFullName: request.sourceFullName,
    sourceOid: source.oid,
    sourceKind: source.kind,
    sourceName: source.name,
    targetFullName,
    newName,
    startHeadRef,
    startHeadOid: snapshot.branch.oid,
    upstream: source.upstream,
    mergedIntoCurrent,
    worktreePath,
    deleteRemote: request.deleteRemote,
    remoteDeletion,
    previewToken: JSON.stringify(fields),
  };
}

export function demoExecuteBranchMutation(
  snapshot: RepositorySnapshot,
  plan: BranchMutationPlan,
): RepositorySnapshot {
  const refreshed = demoPrepareBranchMutation(snapshot, {
    kind: plan.kind,
    sourceFullName: plan.sourceFullName,
    sourceOid: plan.sourceOid,
    newName: plan.newName,
    deleteRemote: plan.deleteRemote,
  });
  if (refreshed.previewToken !== plan.previewToken) {
    throw new Error("The reviewed branch plan is stale; prepare it again.");
  }
  if (plan.kind === "switch") return demoSwitchBranch(snapshot, plan.sourceFullName);
  const next = structuredClone(snapshot);
  if (plan.kind === "removeWorktree") {
    const source = next.branches.find((branch) => branch.fullName === plan.sourceFullName)!;
    source.linkedWorktreePath = null;
    return next;
  }
  if (plan.kind === "delete") {
    next.branches = next.branches.filter((branch) => branch.fullName !== plan.sourceFullName);
    if (plan.remoteDeletion) {
      next.branches = next.branches.filter((branch) => (
        branch.fullName !== plan.remoteDeletion?.trackingFullName
      ));
    }
    return next;
  }
  if (plan.kind === "rename") {
    const source = next.branches.find((branch) => branch.fullName === plan.sourceFullName)!;
    source.name = plan.newName!;
    source.fullName = plan.targetFullName!;
    if (source.current) next.branch.head = plan.newName;
    return next;
  }
  for (const branch of next.branches) branch.current = false;
  const commit = next.commits.find((candidate) => candidate.oid === plan.sourceOid);
  const upstream = plan.kind === "checkoutRemote" ? plan.sourceName : null;
  next.branches.unshift({
    repositoryId: ".", fullName: plan.targetFullName!, name: plan.newName!, oid: plan.sourceOid,
    current: true, kind: "local", upstream, tracking: null,
    committedAt: commit?.authoredAt ?? Math.floor(Date.now() / 1000),
    subject: commit?.subject ?? plan.sourceName,
    linkedWorktreePath: null,
  });
  next.branch = {
    head: plan.newName,
    oid: plan.sourceOid,
    upstream,
    upstreamRemote: upstream?.split("/")[0] ?? null,
    upstreamRef: upstream ? `refs/heads/${upstream.split("/").slice(1).join("/")}` : null,
    ahead: 0,
    behind: 0,
    detached: false,
    unborn: false,
  };
  return next;
}

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

function historyFromOid(snapshot: RepositorySnapshot, tip: string | null) {
  const byOid = new Map(snapshot.commits.map((commit) => [commit.oid, commit]));
  const reachable = new Set<string>();
  const pending = tip ? [tip] : [];
  while (pending.length > 0) {
    const oid = pending.pop();
    if (!oid || reachable.has(oid)) continue;
    reachable.add(oid);
    pending.push(...(byOid.get(oid)?.parents ?? []));
  }
  return snapshot.commits.filter((commit) => reachable.has(commit.oid));
}

function ensureDemoBranchMutationIsSafe(snapshot: RepositorySnapshot): void {
  if (snapshot.untrackedState !== "complete") {
    throw new Error("Wait for the working-tree scan to finish.");
  }
  if (snapshot.changes.length > 0) {
    throw new Error("Commit, stash, or remove working-tree changes before continuing.");
  }
}
