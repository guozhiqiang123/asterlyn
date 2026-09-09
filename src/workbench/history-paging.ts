import type { CommitSummary, HistoryPage } from "../models";
import { commitKey } from "./history-identity.ts";

export interface HistoryWindow {
  commits: CommitSummary[];
  nextOffset: number;
  hasMore: boolean;
}

export interface HistoryPageRequestIdentity {
  sequence: number;
  generation: number;
  root: string;
  queryKey: string;
}

export function matchesHistoryPageRequest(
  request: HistoryPageRequestIdentity,
  current: HistoryPageRequestIdentity,
): boolean {
  return (
    request.sequence === current.sequence &&
    request.generation === current.generation &&
    request.root === current.root &&
    request.queryKey === current.queryKey
  );
}

export function appendHistoryPage(
  current: CommitSummary[],
  page: HistoryPage,
  rowLimit: number,
): HistoryWindow {
  const seen = new Set(current.map(commitKey));
  const appended = page.commits.filter((commit) => {
    const key = commitKey(commit);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return finishWindow([...current, ...appended], page, rowLimit);
}

export function replaceHistoryPage(
  page: HistoryPage,
  rowLimit: number,
): HistoryWindow {
  const seen = new Set<string>();
  const commits = page.commits.filter((commit) => {
    const key = commitKey(commit);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return finishWindow(commits, page, rowLimit);
}

function finishWindow(
  commits: CommitSummary[],
  page: HistoryPage,
  rowLimit: number,
): HistoryWindow {
  const bounded = commits.slice(0, rowLimit);
  const nextOffset = page.offset + page.commits.length;
  return {
    commits: bounded,
    nextOffset,
    hasMore:
      page.hasMore && nextOffset < rowLimit && bounded.length < rowLimit,
  };
}
