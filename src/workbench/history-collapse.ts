import type { CommitSummary } from "../models";
import { commitKey, parentCommitKey } from "./history-identity.ts";

export type HistoryDisplayEntry =
  | {
      kind: "commit";
      commit: CommitSummary;
      graphCommit: Pick<CommitSummary, "repositoryId" | "oid" | "parents">;
    }
  | {
      kind: "collapsed";
      id: string;
      count: number;
      firstOid: string;
      firstKey: string;
      graphCommit: Pick<CommitSummary, "repositoryId" | "oid" | "parents">;
    };

export function collapseLinearHistory(
  commits: CommitSummary[],
  selectedKey: string | null,
): HistoryDisplayEntry[] {
  if (commits.length < 4) return commitEntries(commits);
  const loaded = new Set(commits.map(commitKey));
  const childCounts = new Map(commits.map((commit) => [commitKey(commit), 0]));
  for (const commit of commits) {
    for (const parent of commit.parents) {
      const parentKey = parentCommitKey(commit.repositoryId, parent);
      if (loaded.has(parentKey)) {
        childCounts.set(parentKey, (childCounts.get(parentKey) ?? 0) + 1);
      }
    }
  }

  const rawEntries: Array<
    | { kind: "commit"; commit: CommitSummary }
    | {
        kind: "collapsed";
        id: string;
        count: number;
        firstOid: string;
        parentOid: string;
        repositoryId: string;
      }
  > = [];
  const collapsedStarts = new Map<string, string>();
  let index = 0;
  while (index < commits.length) {
    if (!isCollapsible(commits, index, childCounts, selectedKey)) {
      rawEntries.push({ kind: "commit", commit: commits[index]! });
      index += 1;
      continue;
    }
    const start = index;
    let end = start;
    while (
      end + 1 < commits.length &&
      isCollapsible(commits, end + 1, childCounts, selectedKey) &&
      commits[end]!.repositoryId === commits[end + 1]!.repositoryId &&
      commits[end]!.parents[0] === commits[end + 1]!.oid
    ) {
      end += 1;
    }
    const count = end - start + 1;
    if (count < 2) {
      rawEntries.push({ kind: "commit", commit: commits[index]! });
      index += 1;
      continue;
    }
    const first = commits[start]!;
    const last = commits[end]!;
    const id = `collapsed:${commitKey(first)}:${commitKey(last)}`;
    collapsedStarts.set(commitKey(first), id);
    rawEntries.push({
      kind: "collapsed",
      id,
      count,
      firstOid: first.oid,
      parentOid: last.parents[0]!,
      repositoryId: first.repositoryId,
    });
    index = end + 1;
  }

  return rawEntries.map((entry) =>
    entry.kind === "collapsed"
      ? {
          kind: "collapsed",
          id: entry.id,
          count: entry.count,
          firstOid: entry.firstOid,
          firstKey: parentCommitKey(entry.repositoryId, entry.firstOid),
          graphCommit: {
            repositoryId: entry.repositoryId,
            oid: entry.id,
            parents: [entry.parentOid],
          },
        }
      : {
          kind: "commit",
          commit: entry.commit,
          graphCommit: {
            oid: entry.commit.oid,
            repositoryId: entry.commit.repositoryId,
            parents: entry.commit.parents.map((parent) =>
              collapsedStarts.get(parentCommitKey(entry.commit.repositoryId, parent)) ?? parent
            ),
          },
        },
  );
}

function commitEntries(commits: CommitSummary[]): HistoryDisplayEntry[] {
  return commits.map((commit) => ({
    kind: "commit",
    commit,
    graphCommit: commit,
  }));
}

function isCollapsible(
  commits: CommitSummary[],
  index: number,
  childCounts: Map<string, number>,
  selectedKey: string | null,
): boolean {
  const commit = commits[index]!;
  return (
    index > 0 &&
    index < commits.length - 1 &&
    commitKey(commit) !== selectedKey &&
    commit.decorations.length === 0 &&
    commit.parents.length === 1 &&
    childCounts.get(commitKey(commit)) === 1
  );
}
