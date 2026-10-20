import { demoExecuteHeadCommitMutation, demoPrepareHeadCommitMutation } from "../../demo-reviewed-mutations.ts";
import type { RepositoryMutationOutcome, RepositorySnapshot } from "../../models.ts";
import type { GitOperationBridge } from "../../protocol/desktop-bridge.ts";

type HeadCommitMutationBridge = Pick<
  GitOperationBridge,
  "prepareHeadCommitMutation" | "executeHeadCommitMutation"
>;

export function demoHeadCommitMutationBridge(
  snapshot: () => RepositorySnapshot,
  replace: (snapshot: RepositorySnapshot) => void,
  complete: () => RepositoryMutationOutcome,
  delay: (milliseconds?: number) => Promise<void>,
): HeadCommitMutationBridge {
  return {
    prepareHeadCommitMutation: async (_root, _repositoryId, selectedHeadOid, kind) =>
      demoPrepareHeadCommitMutation(snapshot(), selectedHeadOid, kind),
    executeHeadCommitMutation: async (_root, _repositoryId, plan, kind) => {
      await delay(220);
      replace(demoExecuteHeadCommitMutation(snapshot(), plan, kind));
      return complete();
    },
  };
}
