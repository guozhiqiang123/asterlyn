import type { CommitDetails, CommitFileChange } from "../models";

export function filesForPushReview(
  aggregateFiles: CommitFileChange[],
  selectedCommitOid: string | null,
  selectedCommitDetails: CommitDetails | null,
): CommitFileChange[] {
  if (!selectedCommitOid) return aggregateFiles;
  return selectedCommitDetails?.oid === selectedCommitOid
    ? selectedCommitDetails.files
    : [];
}
