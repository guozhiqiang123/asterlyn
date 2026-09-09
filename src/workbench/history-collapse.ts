import type { CommitSummary } from "../models";

export type HistoryDisplayEntry =
  | {
      kind: "commit";
      commit: CommitSummary;
      graphCommit: Pick<CommitSummary, "oid" | "parents">;
    }
  | {
      kind: "collapsed";
      id: string;
      count: number;
      firstOid: string;
      graphCommit: Pick<CommitSummary, "oid" | "parents">;
    };

export function collapseLinearHistory(
  commits: CommitSummary[],
  selectedOid: string | null,
): HistoryDisplayEntry[] {
  if (commits.length < 4) return commitEntries(commits);
  const loaded = new Set(commits.map((commit) => commit.oid));
  const childCounts = new Map(commits.map((commit) => [commit.oid, 0]));
  for (const commit of commits) {
    for (const parent of commit.parents) {
      if (loaded.has(parent)) childCounts.set(parent, (childCounts.get(parent) ?? 0) + 1);
    }
  }

  const rawEntries: Array<
    | { kind: "commit"; commit: CommitSummary }
    | { kind: "collapsed"; id: string; count: number; firstOid: string; parentOid: string }
  > = [];
  const collapsedStarts = new Map<string, string>();
  let index = 0;
  while (index < commits.length) {
    if (!isCollapsible(commits, index, childCounts, selectedOid)) {
      rawEntries.push({ kind: "commit", commit: commits[index]! });
      index += 1;
      continue;
    }
    const start = index;
    let end = start;
    while (
      end + 1 < commits.length &&
      isCollapsible(commits, end + 1, childCounts, selectedOid) &&
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
    const id = `collapsed:${first.oid}:${last.oid}`;
    collapsedStarts.set(first.oid, id);
    rawEntries.push({
      kind: "collapsed",
      id,
      count,
      firstOid: first.oid,
      parentOid: last.parents[0]!,
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
          graphCommit: { oid: entry.id, parents: [entry.parentOid] },
        }
      : {
          kind: "commit",
          commit: entry.commit,
          graphCommit: {
            oid: entry.commit.oid,
            parents: entry.commit.parents.map((parent) => collapsedStarts.get(parent) ?? parent),
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
  selectedOid: string | null,
): boolean {
  const commit = commits[index]!;
  return (
    index > 0 &&
    index < commits.length - 1 &&
    commit.oid !== selectedOid &&
    commit.decorations.length === 0 &&
    commit.parents.length === 1 &&
    childCounts.get(commit.oid) === 1
  );
}
