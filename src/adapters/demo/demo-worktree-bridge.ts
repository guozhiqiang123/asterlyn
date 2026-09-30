import { demoTrackedSnapshot } from "../../demo.ts";
import type {
  RepositoryMutationOutcome,
  RepositorySnapshot,
  WorkspaceRevealResult,
  WorktreeCreationPlan,
  WorktreeCreationRequest,
} from "../../models.ts";
import type { GitOperationBridge, WorkspaceBridge } from "../../protocol/desktop-bridge.ts";
import { invokeDesktopCommand, isTauriRuntime } from "../tauri/desktop-command-adapter.ts";

type WorktreeBridge = Pick<
  GitOperationBridge,
  "prepareWorktreeCreation" | "executeWorktreeCreation"
> & Pick<WorkspaceBridge, "revealRegisteredWorktree">;

const COMPLETE_SLICES = [
  "workspaceCatalog", "openDocuments", "repositoryCapability", "workingTree",
  "head", "refs", "history", "operation",
] as const;

export function createDemoWorktreeBridge(
  snapshot: () => RepositorySnapshot,
  replaceSnapshot: (next: RepositorySnapshot) => void,
): WorktreeBridge {
  return {
    async prepareWorktreeCreation(repositoryRoot, request) {
      if (isTauriRuntime) {
        return invokeDesktopCommand<WorktreeCreationPlan>("prepare_worktree_creation", {
          repositoryRoot,
          request,
        });
      }
      return prepareDemoWorktree(snapshot(), repositoryRoot, request);
    },
    async executeWorktreeCreation(repositoryRoot, plan) {
      if (isTauriRuntime) {
        return invokeDesktopCommand<RepositoryMutationOutcome>("execute_worktree_creation", {
          repositoryRoot,
          plan,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 220));
      const next = executeDemoWorktree(snapshot(), plan);
      replaceSnapshot(next);
      return {
        snapshot: demoTrackedSnapshot(next),
        invalidatedSlices: [...COMPLETE_SLICES],
      };
    },
    async revealRegisteredWorktree(repositoryRoot, sourceFullName, sourceOid) {
      if (isTauriRuntime) {
        return invokeDesktopCommand<WorkspaceRevealResult>("reveal_registered_worktree", {
          repositoryRoot,
          sourceFullName,
          sourceOid,
        });
      }
      const source = snapshot().branches.find((branch) =>
        branch.fullName === sourceFullName && branch.oid === sourceOid &&
        Boolean(branch.linkedWorktreePath)
      );
      if (!source) throw new Error("The linked worktree changed.");
      return { selected: false };
    },
  };
}

function prepareDemoWorktree(
  snapshot: RepositorySnapshot,
  repositoryRoot: string,
  request: WorktreeCreationRequest,
): WorktreeCreationPlan {
  const source = snapshot.branches.find((branch) =>
    branch.repositoryId === "." && (branch.kind === "local" || branch.kind === "remote") &&
    branch.fullName === request.sourceFullName && branch.oid === request.sourceOid
  );
  if (!source) throw new Error("The selected local or remote-tracking branch changed.");
  const parent = request.parentDirectory.replace(/[\\/]+$/u, "");
  const destinationPath = `${parent}/${request.projectName}`;
  return {
    repositoryRoot,
    sourceFullName: source.fullName,
    sourceName: source.name,
    sourceOid: source.oid,
    parentDirectory: request.parentDirectory,
    projectName: request.projectName,
    destinationPath,
    newBranch: request.newBranch,
    startHeadRef: snapshot.branch.head ? `refs/heads/${snapshot.branch.head}` : "DETACHED",
    startHeadOid: snapshot.branch.oid ?? source.oid,
    previewToken: `demo-worktree:${source.oid}:${destinationPath}:${request.newBranch ?? "detached"}`,
  };
}

function executeDemoWorktree(
  snapshot: RepositorySnapshot,
  plan: WorktreeCreationPlan,
): RepositorySnapshot {
  if (!plan.newBranch) return snapshot;
  return {
    ...snapshot,
    branches: [...snapshot.branches, {
      repositoryId: ".",
      fullName: `refs/heads/${plan.newBranch}`,
      name: plan.newBranch,
      oid: plan.sourceOid,
      current: false,
      kind: "local",
      upstream: null,
      tracking: null,
      committedAt: Date.now() / 1000,
      subject: `Worktree from ${plan.sourceName}`,
      primaryWorktreePath: null,
      linkedWorktreePath: plan.destinationPath,
    }],
  };
}
