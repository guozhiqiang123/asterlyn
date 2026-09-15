import type { FileChange, RepositorySnapshot } from "../../models.ts";
import type { WorkspaceTargetIdentity } from "../../application/workbench-navigation.ts";
import {
  DelegatedContextBinding,
  type DelegatedContextRequest,
} from "../../shared/context-menu/delegated-context-binding.ts";

export interface ChangesContextTarget extends WorkspaceTargetIdentity {
  readonly workspacePath: string;
  readonly kind: "file";
  readonly repositoryId: string;
  readonly repositoryRevision: number;
  readonly path: string;
  readonly change: FileChange;
}

export class ChangesContextBinding {
  private readonly binding: DelegatedContextBinding<ChangesContextTarget>;

  constructor(
    root: HTMLElement,
    current: () => {
      readonly snapshot: RepositorySnapshot | null;
      readonly workspaceGeneration: number;
      readonly repositoryId: string;
      readonly repositoryRevision: number;
    },
    open: (request: DelegatedContextRequest<ChangesContextTarget>) => boolean,
  ) {
    this.binding = new DelegatedContextBinding(root, {
      selector: "[data-change-path]",
      resolve: (trigger) => {
        const path = trigger.dataset.changePath;
        const context = current();
        return path
          ? resolveChangesContextTarget(
              context.snapshot,
              context.workspaceGeneration,
              path,
              context.repositoryId,
              context.repositoryRevision,
            )
          : null;
      },
      open,
    });
  }

  dispose(): void {
    this.binding.dispose();
  }
}

export function resolveChangesContextTarget(
  snapshot: RepositorySnapshot | null,
  workspaceGeneration: number,
  path: string,
  repositoryId = ".",
  repositoryRevision = 0,
): ChangesContextTarget | null {
  const change = snapshot?.changes.find((candidate) => candidate.path === path);
  return snapshot && change
    ? {
        workspaceRoot: snapshot.root,
        workspaceGeneration,
        workspacePath: path,
        kind: "file",
        repositoryId,
        repositoryRevision,
        path,
        change: { ...change },
      }
    : null;
}
