import type { RepositoryMutationOutcome, RepositorySnapshot } from "../../models.ts";
import type { RemoteCopy } from "../../localization/catalog.ts";

export interface RemoteOperationCompletionFeedback {
  message: string;
  prominent: boolean;
}

export function remoteOperationCompletionFeedback(
  kind: "fetch" | "pull" | "push",
  before: RepositorySnapshot,
  outcome: RepositoryMutationOutcome,
  copy: RemoteCopy,
): RemoteOperationCompletionFeedback {
  const unchangedUpdate = kind === "pull" &&
    before.branch.oid === outcome.snapshot.branch.oid;
  return {
    message: unchangedUpdate
      ? copy.alreadyUpToDate
      : copy.operationCompleted(copy.actionNames[kind]),
    prominent: unchangedUpdate,
  };
}
