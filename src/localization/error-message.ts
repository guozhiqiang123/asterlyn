import type { ErrorCopy } from "./catalog.ts";

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
