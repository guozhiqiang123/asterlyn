export interface ErrorCopy {
  remoteCancelledUnknown: string;
  remoteCancelledChanged: string;
  remoteCancelled: string;
  remoteFailedFallback: string;
  authenticationFailed: string;
  networkFailed: string;
  remoteRejected: string;
  remotePush: {
    tagAlreadyExistsTitle: string;
    tagAlreadyExistsDetail(remote: string, tag: string): string;
    tagAlreadyExistsGuidance: string;
    nonFastForwardTitle: string;
    nonFastForwardDetail(remote: string, branch: string): string;
    nonFastForwardGuidance: string;
    staleLeaseTitle: string;
    staleLeaseDetail(remote: string, ref: string): string;
    staleLeaseGuidance: string;
    permissionDeniedTitle: string;
    permissionDeniedDetail(remote: string, ref: string): string;
    permissionDeniedGuidance: string;
    hookRejectedTitle: string;
    hookRejectedDetail(remote: string, ref: string): string;
    hookRejectedGuidance: string;
    refRejectedTitle: string;
    refRejectedDetail(remote: string, ref: string): string;
    refRejectedGuidance: string;
    atomicUnchanged: string;
    excludeTagsAndReview: string;
  };
  fileConflictPreserved: string;
  unexpectedOperation: string;
  watchUnavailable(detail?: string): string;
  watchStartFailed(detail: string): string;
  watchSuspended(): string;
  externalReconcileFailed(detail: string): string;
  translate(message: string): string;
}
