import type { ContextMenuAvailability } from "../../shared/context-menu/context-menu-model.ts";
import type { HistoryCommitContextTarget } from "./history-context-binding.ts";
import type { CommitSummary } from "../../models.ts";

export interface HistoryCommitContextPolicyReasons {
  readonly busy: string;
  readonly cleanRequired: string;
  readonly localBranchRequired: string;
  readonly mergeMainlineRequired: string;
}

export interface HistoryCommitContextPolicyOptions {
  readonly busy: boolean;
  readonly clean: boolean;
  readonly cleanReason: string;
  readonly localBranch: boolean;
  readonly headOid: string | null;
  readonly historyCommits: readonly CommitSummary[];
  readonly reasons: HistoryCommitContextPolicyReasons;
}

export interface HistoryCommitContextPolicy {
  readonly writable: boolean;
  readonly cherryPick: ContextMenuAvailability;
  readonly revert: ContextMenuAvailability;
  readonly create: ContextMenuAvailability;
  readonly reset: ContextMenuAvailability | null;
}

export function historyCommitContextPolicy(
  target: HistoryCommitContextTarget,
  options: HistoryCommitContextPolicyOptions,
): HistoryCommitContextPolicy {
  const writable = target.repositoryId === ".";
  const mutation = options.busy
    ? busy(options.reasons.busy)
    : !options.localBranch
      ? blocked(options.reasons.localBranchRequired)
      : !options.clean
        ? blocked(options.cleanReason || options.reasons.cleanRequired)
        : enabled();
  const singleParent = target.commit.parents.length <= 1;
  const commitMutation = singleParent
    ? mutation
    : blocked(options.reasons.mergeMainlineRequired);
  const currentBranchCommit = Boolean(
    writable && options.localBranch && options.headOid && target.oid !== options.headOid &&
    historyContains(options.historyCommits, options.headOid!, target.oid),
  );
  const reset = !currentBranchCommit ? null : options.busy ? busy(options.reasons.busy) : enabled();
  return { writable, cherryPick: commitMutation, revert: commitMutation, create: mutation, reset };
}

function historyContains(commits: readonly CommitSummary[], headOid: string, targetOid: string): boolean {
  const byOid = new Map(commits.filter((commit) => commit.repositoryId === ".").map((commit) => [commit.oid, commit]));
  const pending = [headOid];
  const visited = new Set<string>();
  while (pending.length) {
    const oid = pending.pop()!;
    if (oid === targetOid) return true;
    if (visited.has(oid)) continue;
    visited.add(oid);
    pending.push(...(byOid.get(oid)?.parents ?? []));
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
