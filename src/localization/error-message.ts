import type { ErrorCopy } from "./catalog.ts";

export interface OperationErrorRecovery {
  kind: "excludePushTags";
  label: string;
}

export interface OperationErrorPresentation {
  summary: string;
  detail?: string;
  guidance?: string;
  recovery?: OperationErrorRecovery;
}

export function localizedOperationError(error: unknown, copy: ErrorCopy): string {
  if (error instanceof Error) return copy.translate(error.message);
  if (typeof error === "string") return copy.translate(error);
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    if (value.kind === "remoteCancelled") {
      if (value.remoteStateMayHaveChanged === true) {
        return copy.remoteCancelledUnknown;
      }
      return value.repositoryStateMayHaveChanged === true
        ? copy.remoteCancelledChanged
        : copy.remoteCancelled;
    }
    if (value.kind === "remoteFailed") {
      const reason = typeof value.reason === "string" ? value.reason : "unknown";
      const messages: Record<string, string> = {
        authentication: copy.authenticationFailed,
        network: copy.networkFailed,
        tagConflict: copy.tagConflict,
        rejected: copy.remoteRejected,
        unknown: copy.remoteFailedFallback,
      };
      return messages[reason] ?? copy.remoteFailedFallback;
    }
    if (value.kind === "conflict") {
      return copy.fileConflictPreserved;
    }
    const message = typeof value.message === "string" ? value.message : null;
    const operation = typeof value.operation === "string" ? value.operation : null;
    if (message && operation) return `${operation}: ${copy.translate(message)}`;
    if (message) return copy.translate(message);
  }
  return copy.unexpectedOperation;
}

export function localizedRemoteOperationError(
  error: unknown,
  copy: ErrorCopy,
  fallbackSummary: string,
): OperationErrorPresentation {
  const fallback = (): OperationErrorPresentation => ({
    summary: fallbackSummary,
    detail: localizedOperationError(error, copy),
  });
  if (!error || typeof error !== "object") return fallback();
  const value = error as Record<string, unknown>;
  if (value.kind !== "remoteFailed") return fallback();
  const remote = boundedProtocolLabel(value.remote);
  const failures = Array.isArray(value.refFailures)
    ? value.refFailures.slice(0, 8).map(readRemoteRefFailure).filter(isRemoteRefFailure)
    : [];
  const primary = failures.find((failure) => failure.primary) ??
    failures.find((failure) => failure.reason !== "atomicPushFailed") ?? failures[0];
  if (!remote || !primary) return fallback();
  const atomic = failures.some((failure) => failure.reason === "atomicPushFailed");
  const withAtomicGuidance = (guidance: string): string =>
    atomic ? `${guidance} ${copy.remotePush.atomicUnchanged}` : guidance;
  switch (primary.reason) {
    case "alreadyExists":
      if (primary.refKind !== "tag") return rejectedRefPresentation(remote, primary.refName, copy, atomic);
      return {
        summary: copy.remotePush.tagAlreadyExistsTitle,
        detail: copy.remotePush.tagAlreadyExistsDetail(remote, primary.refName),
        guidance: withAtomicGuidance(copy.remotePush.tagAlreadyExistsGuidance),
        recovery: {
          kind: "excludePushTags",
          label: copy.remotePush.excludeTagsAndReview,
        },
      };
    case "nonFastForward":
      return {
        summary: copy.remotePush.nonFastForwardTitle,
        detail: copy.remotePush.nonFastForwardDetail(remote, primary.refName),
        guidance: withAtomicGuidance(copy.remotePush.nonFastForwardGuidance),
      };
    case "staleLease":
      return {
        summary: copy.remotePush.staleLeaseTitle,
        detail: copy.remotePush.staleLeaseDetail(remote, primary.refName),
        guidance: withAtomicGuidance(copy.remotePush.staleLeaseGuidance),
      };
    case "permissionDenied":
      return {
        summary: copy.remotePush.permissionDeniedTitle,
        detail: copy.remotePush.permissionDeniedDetail(remote, primary.refName),
        guidance: withAtomicGuidance(copy.remotePush.permissionDeniedGuidance),
      };
    case "hookRejected":
      return {
        summary: copy.remotePush.hookRejectedTitle,
        detail: copy.remotePush.hookRejectedDetail(remote, primary.refName),
        guidance: withAtomicGuidance(copy.remotePush.hookRejectedGuidance),
      };
    default:
      return rejectedRefPresentation(remote, primary.refName, copy, atomic);
  }
}

interface RemoteRefFailurePayload {
  refKind: "branch" | "tag" | "other";
  refName: string;
  reason: "alreadyExists" | "nonFastForward" | "staleLease" | "permissionDenied" |
    "hookRejected" | "atomicPushFailed" | "rejected";
  primary: boolean;
}

function readRemoteRefFailure(value: unknown): RemoteRefFailurePayload | null {
  if (!value || typeof value !== "object") return null;
  const failure = value as Record<string, unknown>;
  const refName = boundedProtocolLabel(failure.refName);
  const refKinds = new Set(["branch", "tag", "other"]);
  const reasons = new Set([
    "alreadyExists",
    "nonFastForward",
    "staleLease",
    "permissionDenied",
    "hookRejected",
    "atomicPushFailed",
    "rejected",
  ]);
  if (!refName || !refKinds.has(String(failure.refKind)) || !reasons.has(String(failure.reason))) {
    return null;
  }
  return {
    refKind: failure.refKind as RemoteRefFailurePayload["refKind"],
    refName,
    reason: failure.reason as RemoteRefFailurePayload["reason"],
    primary: failure.primary === true,
  };
}

function isRemoteRefFailure(
  failure: RemoteRefFailurePayload | null,
): failure is RemoteRefFailurePayload {
  return failure !== null;
}

function boundedProtocolLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const bounded = Array.from(value)
    .filter((character) => !/[\u0000-\u001f\u007f]/u.test(character))
    .slice(0, 256)
    .join("");
  return bounded || null;
}

function rejectedRefPresentation(
  remote: string,
  refName: string,
  copy: ErrorCopy,
  atomic: boolean,
): OperationErrorPresentation {
  const guidance = atomic
    ? `${copy.remotePush.refRejectedGuidance} ${copy.remotePush.atomicUnchanged}`
    : copy.remotePush.refRejectedGuidance;
  return {
    summary: copy.remotePush.refRejectedTitle,
    detail: copy.remotePush.refRejectedDetail(remote, refName),
    guidance,
  };
}
