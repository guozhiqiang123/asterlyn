import type { CommitDetails, CommitFileChange, PushPreview } from "../../models";

export interface PushConfirmationAvailabilityInput {
  operationActive: boolean;
  previewLoading: boolean;
  previewRefreshing: boolean;
  actionable: boolean;
  modeAllowed: boolean;
}

export interface PushConfirmationAvailability {
  nativeDisabled: boolean;
  ariaDisabled: boolean;
}

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

export function nextPushCommitSelection(
  selectedCommitOid: string | null,
  activatedCommitOid: string,
): string | null {
  return selectedCommitOid === activatedCommitOid ? null : activatedCommitOid;
}

export function isPushPreviewActionable(preview: PushPreview | null): boolean {
  return Boolean(preview && (
    preview.publish ||
    preview.totalCommits > 0 ||
    preview.tags.length > 0 ||
    preview.comparisonBaseOid !== preview.headOid
  ));
}

export function pushConfirmationAvailability({
  operationActive,
  previewLoading,
  previewRefreshing,
  actionable,
  modeAllowed,
}: PushConfirmationAvailabilityInput): PushConfirmationAvailability {
  const nativeDisabled =
    operationActive || previewLoading || !actionable || !modeAllowed;
  return {
    nativeDisabled,
    ariaDisabled: nativeDisabled || previewRefreshing,
  };
}
