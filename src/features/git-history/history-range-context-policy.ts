import type { CommitSummary } from "../../models.ts";
import type { ContextMenuAvailability } from "../../shared/context-menu/context-menu-model.ts";
import type { HistoryCommitRangeTarget } from "./history-range-context.ts";

export interface HistoryCommitRangePolicyReasons {
  readonly busy: string;
  readonly cleanRequired: string;
  readonly localBranchRequired: string;
  readonly sameRootRequired: string;
  readonly topLevelRequired: string;
  readonly linearRequired: string;
  readonly mergeRequired: string;
  readonly currentBranchRequired: string;
  readonly headSuffixRequired: string;
  readonly rootBaseRequired: string;
}

export interface HistoryCommitRangePolicyOptions {
  readonly busy: boolean;
  readonly clean: boolean;
  readonly cleanReason: string;
  readonly localBranch: boolean;
  readonly headOid: string | null;
  readonly historyCommits: readonly CommitSummary[];
  readonly reasons: HistoryCommitRangePolicyReasons;
}

export interface HistoryCommitRangePolicy {
  readonly sameRoot: boolean;
  readonly topLevel: boolean;
  readonly linear: boolean;
  readonly mergeFree: boolean;
  readonly oldestToNewest: readonly CommitSummary[];
  readonly newestToOldest: readonly CommitSummary[];
  readonly squashBaseOid: string | null;
  readonly cherryPick: ContextMenuAvailability;
  readonly revert: ContextMenuAvailability;
  readonly squash: ContextMenuAvailability;
}

export function historyCommitRangePolicy(
  target: HistoryCommitRangeTarget,
  options: HistoryCommitRangePolicyOptions,
): HistoryCommitRangePolicy {
  const commits = [...target.commits];
  const repositoryIds = new Set(commits.map((commit) => commit.repositoryId));
  const sameRoot = repositoryIds.size === 1;
  const topLevel = sameRoot && commits[0]?.repositoryId === ".";
  const mergeFree = commits.every((commit) => commit.parents.length <= 1);
  const forward = isDirectChain(commits);
  const reverse = !forward && isDirectChain([...commits].reverse());
  const linear = forward || reverse;
  const newestToOldest = forward ? commits : reverse ? [...commits].reverse() : [];
  const oldestToNewest = [...newestToOldest].reverse();
  const newest = newestToOldest[0] ?? null;
  const oldest = newestToOldest.at(-1) ?? null;
  const squashBaseOid = oldest?.parents[0] ?? null;
  const currentBranchSegment = Boolean(
    linear && newest && options.headOid &&
    firstParentChainContains(options.historyCommits, options.headOid, newest.oid),
  );
  const headSuffix = newest?.oid === options.headOid;
  const mutation = options.busy
    ? busy(options.reasons.busy)
    : !options.localBranch
      ? blocked(options.reasons.localBranchRequired)
      : !options.clean
        ? blocked(options.cleanReason || options.reasons.cleanRequired)
        : enabled();
  const structure = !sameRoot
    ? blocked(options.reasons.sameRootRequired)
    : !topLevel
      ? blocked(options.reasons.topLevelRequired)
      : !linear
        ? blocked(options.reasons.linearRequired)
        : !mergeFree
          ? blocked(options.reasons.mergeRequired)
          : enabled();
  const cherryPick = structure.kind !== "enabled" ? structure : mutation;
  const revert = structure.kind !== "enabled"
    ? structure
    : !currentBranchSegment
      ? blocked(options.reasons.currentBranchRequired)
      : mutation;
  const squash = structure.kind !== "enabled"
    ? structure
    : !headSuffix
      ? blocked(options.reasons.headSuffixRequired)
      : !squashBaseOid
        ? blocked(options.reasons.rootBaseRequired)
        : mutation;
  return {
    sameRoot, topLevel, linear, mergeFree, oldestToNewest, newestToOldest,
    squashBaseOid, cherryPick, revert, squash,
  };
}

function isDirectChain(commits: readonly CommitSummary[]): boolean {
  return commits.length >= 2 && commits.slice(0, -1).every(
    (commit, index) => commit.parents[0] === commits[index + 1]?.oid,
  );
}

function firstParentChainContains(
  commits: readonly CommitSummary[],
  headOid: string,
  targetOid: string,
): boolean {
  const byOid = new Map(
    commits.filter((commit) => commit.repositoryId === ".").map((commit) => [commit.oid, commit]),
  );
  let oid: string | undefined = headOid;
  const visited = new Set<string>();
  while (oid && !visited.has(oid)) {
    if (oid === targetOid) return true;
    visited.add(oid);
    oid = byOid.get(oid)?.parents[0];
  }
  return false;
}

function enabled(): ContextMenuAvailability {
  return { kind: "enabled" };
}

function blocked(reason: string): ContextMenuAvailability {
  return { kind: "blocked", reason };
}

function busy(label: string): ContextMenuAvailability {
  return { kind: "busy", label };
}
