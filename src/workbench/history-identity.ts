import type { BranchSummary, CommitSummary, HistoryPath, HistoryRef } from "../models";

export function historyRefKey(reference: HistoryRef): string {
  return `${encodeURIComponent(reference.repositoryId)}:${encodeURIComponent(reference.fullName)}`;
}

export function branchKey(branch: Pick<BranchSummary, "repositoryId" | "fullName">): string {
  return historyRefKey(branch);
}

export function historyPathKey(path: HistoryPath): string {
  return `${encodeURIComponent(path.repositoryId)}:${encodeURIComponent(path.path)}`;
}

export function commitKey(commit: Pick<CommitSummary, "repositoryId" | "oid">): string {
  return `${encodeURIComponent(commit.repositoryId)}:${commit.oid}`;
}

export function parentCommitKey(repositoryId: string, oid: string): string {
  return `${encodeURIComponent(repositoryId)}:${oid}`;
}
