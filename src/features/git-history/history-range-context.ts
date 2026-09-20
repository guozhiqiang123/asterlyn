import type { CommitSummary } from "../../models.ts";
import { commitKey } from "./history-identity.ts";
import type { GitHistoryDetailsState } from "./history-details-controller.ts";
import type { HistoryCommitContextTarget } from "./history-context-binding.ts";
import type { HistoryRangeSelection } from "./history-range-selection.ts";

export interface HistoryCommitRangeTarget {
  readonly workspaceRoot: string;
  readonly workspaceGeneration: number;
  readonly repositoryRevision: number;
  readonly historyGeneration: number;
  readonly scopeKey: string;
  readonly anchorKey: string;
  readonly activeKey: string;
  readonly commits: readonly CommitSummary[];
}

export function resolveHistoryCommitRangeTarget(
  row: HistoryCommitContextTarget,
  selection: HistoryRangeSelection | null,
): HistoryCommitRangeTarget | null {
  if (
    !selection ||
    selection.commits.length < 2 ||
    !selection.commits.some((commit) => commitKey(commit) === row.key)
  ) return null;
  return {
    workspaceRoot: row.workspaceRoot,
    workspaceGeneration: row.workspaceGeneration,
    repositoryRevision: row.repositoryRevision,
    historyGeneration: row.historyGeneration,
    scopeKey: selection.scopeKey,
    anchorKey: selection.anchorKey,
    activeKey: selection.activeKey,
    commits: selection.commits.map(cloneCommit),
  };
}

export function historyCommitRangeTargetIsCurrent(
  target: HistoryCommitRangeTarget,
  selection: HistoryRangeSelection | null,
  state: GitHistoryDetailsState,
  workspaceGeneration: number,
): boolean {
  if (
    !selection ||
    state.history.root !== target.workspaceRoot ||
    workspaceGeneration !== target.workspaceGeneration ||
    selection.scopeKey !== target.scopeKey ||
    selection.anchorKey !== target.anchorKey ||
    selection.activeKey !== target.activeKey ||
    selection.commits.length !== target.commits.length
  ) return false;
  const currentByKey = new Map(state.history.commits.map((commit) => [commitKey(commit), commit]));
  return target.commits.every((commit, index) => {
    const selected = selection.commits[index];
    const current = currentByKey.get(commitKey(commit));
    return Boolean(
      selected && current && sameCommit(commit, selected) && sameCommit(commit, current),
    );
  });
}

function sameCommit(left: CommitSummary, right: CommitSummary): boolean {
  return left.repositoryId === right.repositoryId && left.oid === right.oid &&
    left.subject === right.subject && left.parents.length === right.parents.length &&
    left.parents.every((parent, index) => parent === right.parents[index]);
}

function cloneCommit(commit: CommitSummary): CommitSummary {
  return { ...commit, parents: [...commit.parents], decorations: [...commit.decorations] };
}
