import type { BranchSummary, CommitSummary } from "../models";
import { historyRefKey } from "../history-query.ts";

export { historyPathKey, historyRefKey } from "../history-query.ts";

export function branchKey(branch: Pick<BranchSummary, "repositoryId" | "fullName">): string {
  return historyRefKey(branch);
}

export function commitKey(commit: Pick<CommitSummary, "repositoryId" | "oid">): string {
  return `${encodeURIComponent(commit.repositoryId)}:${commit.oid}`;
}

export function parentCommitKey(repositoryId: string, oid: string): string {
  return `${encodeURIComponent(repositoryId)}:${oid}`;
}
