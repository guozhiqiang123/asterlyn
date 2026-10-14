import type { RepositoryMutationOutcome } from "../../models.ts";
import type { GitOperationBridge } from "../../protocol/desktop-bridge.ts";
import {
  invokeDesktopCommand,
  isTauriRuntime,
} from "../tauri/desktop-command-adapter.ts";

type DemoRemoteOperationBridge = Pick<
  GitOperationBridge,
  "updateLocalBranch" | "cancelRemoteOperation"
>;

export function createDemoRemoteOperationBridge(
  cancelled: Set<string>,
  delay: (milliseconds?: number) => Promise<void>,
  completeMutation: () => RepositoryMutationOutcome,
): DemoRemoteOperationBridge {
  return {
    async updateLocalBranch(repositoryRoot, sourceBranch, expectedOid, operationId) {
      if (!isTauriRuntime) {
        await delay(360);
        if (cancelled.delete(operationKey(repositoryRoot, operationId))) {
          throw new Error("Branch update was cancelled; refresh before continuing.");
        }
        return completeMutation();
      }
      return invokeDesktopCommand<RepositoryMutationOutcome>("update_local_branch", {
        repositoryRoot,
        sourceBranch,
        expectedOid,
        operationId,
      });
    },
    async cancelRemoteOperation(repositoryRoot, operationId) {
      if (!isTauriRuntime) {
        cancelled.add(operationKey(repositoryRoot, operationId));
        return;
      }
      return invokeDesktopCommand<void>("cancel_remote_operation", {
        repositoryRoot,
        operationId,
      });
    },
  };
}

function operationKey(repositoryRoot: string, operationId: string): string {
  return `${repositoryRoot}\u0000${operationId}`;
}
