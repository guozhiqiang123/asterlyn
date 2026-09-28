import { demoCommitDetails, demoCommitDiff, demoSnapshot, demoTrackedSnapshot } from "../../demo.ts";
import type {
  CommitDetails,
  CommitDiffResult,
  RepositoryMutationOutcome,
  RepositorySnapshot,
  StashCatalog,
  StashEntry,
  StashMutationRequest,
} from "../../models.ts";

let stashes: StashEntry[] = [
  {
    repositoryId: ".", reference: "stash@{0}",
    oid: "6e8a4bff25838c2cbf92a2c02440e193e28ad101",
    parentOid: demoSnapshot.branch.oid ?? "", authoredAt: Math.floor(Date.now() / 1000) - 5400,
    subject: "WIP on main: refine stash tool window",
  },
  {
    repositoryId: ".", reference: "stash@{1}",
    oid: "a43ed799988736355654222168f51ca0df016901",
    parentOid: demoSnapshot.branch.oid ?? "", authoredAt: Math.floor(Date.now() / 1000) - 86400,
    subject: "On main: experiment with diff navigation",
  },
];

export function demoStashCatalog(): StashCatalog {
  return { entries: structuredClone(stashes), truncatedRepositoryIds: [] };
}

export function demoStashDetails(repositoryId: string, stashOid: string): CommitDetails {
  const stash = exactStash(repositoryId, stashOid);
  return {
    repositoryId, oid: stashOid, parentOid: stash.parentOid,
    files: structuredClone(demoCommitDetails(demoSnapshot.commits[0]?.oid ?? "").files),
  };
}

export function demoStashDiff(repositoryId: string, stashOid: string, path: string): CommitDiffResult {
  exactStash(repositoryId, stashOid);
  const diff = demoCommitDiff(demoSnapshot.commits[0]?.oid ?? stashOid, path);
  return { ...diff, repositoryId, oid: stashOid };
}

export function demoExecuteStashMutation(
  snapshot: RepositorySnapshot,
  request: StashMutationRequest,
): RepositoryMutationOutcome {
  const current = stashes.find((entry) =>
    entry.repositoryId === request.repositoryId && entry.reference === request.reference && entry.oid === request.oid
  );
  if (request.kind === "clear") {
    const actual = stashes.filter((entry) => entry.repositoryId === request.repositoryId).map((entry) => entry.oid);
    if (actual.join("\0") !== request.expectedOids.join("\0")) stale();
    stashes = stashes.filter((entry) => entry.repositoryId !== request.repositoryId);
  } else {
    if (!current) stale();
    if (request.kind === "pop" || request.kind === "drop" || request.kind === "branch") {
      stashes = stashes.filter((entry) => entry !== current);
    }
  }
  stashes = stashes.map((entry, index) => ({ ...entry, reference: `stash@{${index}}` }));
  return {
    snapshot: demoTrackedSnapshot(snapshot),
    invalidatedSlices: request.kind === "drop" || request.kind === "clear"
      ? [] : ["workingTree", "head", "refs", "history"],
  };
}

function exactStash(repositoryId: string, stashOid: string): StashEntry {
  return stashes.find((entry) => entry.repositoryId === repositoryId && entry.oid === stashOid) ?? stale();
}

function stale(): never {
  throw new Error("The selected stash changed. Refresh and try again.");
}
