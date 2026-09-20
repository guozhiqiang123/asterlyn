import type { FileChange, RepositorySnapshot } from "../../models.ts";
import type { WorkspaceTargetIdentity } from "../../application/workbench-navigation.ts";
import { changeGroup, type ChangeGroupId } from "./change-presentation.ts";
import {
  DelegatedContextBinding,
  type DelegatedContextRequest,
} from "../../shared/context-menu/delegated-context-binding.ts";

export interface ChangesFileContextTarget extends WorkspaceTargetIdentity {
  readonly workspacePath: string;
  readonly kind: "file";
  readonly repositoryId: string;
  readonly repositoryRevision: number;
  readonly path: string;
  readonly change: FileChange;
}

export interface ChangesGroupContextTarget {
  readonly workspaceRoot: string;
  readonly workspaceGeneration: number;
  readonly kind: "group";
  readonly group: "unversioned";
  readonly repositoryId: string;
  readonly repositoryRevision: number;
  readonly paths: readonly string[];
}

export type ChangesContextTarget = ChangesFileContextTarget | ChangesGroupContextTarget;

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
      selector: "[data-change-path], [data-change-group]",
      resolve: (trigger) => {
        const path = trigger.dataset.changePath;
        const group = trigger.dataset.changeGroup as ChangeGroupId | undefined;
        const context = current();
        if (path) return resolveChangesContextTarget(
              context.snapshot,
              context.workspaceGeneration,
              path,
              context.repositoryId,
              context.repositoryRevision,
            );
        return group
          ? resolveChangesGroupContextTarget(
              context.snapshot,
              context.workspaceGeneration,
              group,
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
): ChangesFileContextTarget | null {
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

export function resolveChangesGroupContextTarget(
  snapshot: RepositorySnapshot | null,
  workspaceGeneration: number,
  group: ChangeGroupId,
  repositoryId = ".",
  repositoryRevision = 0,
): ChangesGroupContextTarget | null {
  if (!snapshot || group !== "unversioned" || snapshot.untrackedState !== "complete") return null;
  const paths = snapshot.changes
    .filter((change) => changeGroup(change) === group)
    .map((change) => change.path)
    .sort();
  return paths.length > 0 ? {
    workspaceRoot: snapshot.root,
    workspaceGeneration,
    kind: "group",
    group,
    repositoryId,
    repositoryRevision,
    paths,
  } : null;
}

export function changesContextTargetIsCurrent(
  target: ChangesContextTarget,
  snapshot: RepositorySnapshot | null,
  workspaceGeneration: number,
  repositoryRevision = target.repositoryRevision,
): boolean {
  if (
    !snapshot || snapshot.root !== target.workspaceRoot ||
    workspaceGeneration !== target.workspaceGeneration ||
    repositoryRevision !== target.repositoryRevision
  ) return false;
  if (target.kind === "group") {
    const current = resolveChangesGroupContextTarget(
      snapshot,
      workspaceGeneration,
      target.group,
      target.repositoryId,
      repositoryRevision,
    );
    return Boolean(
      current && current.paths.length === target.paths.length &&
      current.paths.every((path, index) => path === target.paths[index]),
    );
  }
  const current = resolveChangesContextTarget(
    snapshot,
    workspaceGeneration,
    target.path,
    target.repositoryId,
    target.repositoryRevision,
  );
  return Boolean(
    current && current.change.originalPath === target.change.originalPath &&
    current.change.indexStatus === target.change.indexStatus &&
    current.change.worktreeStatus === target.change.worktreeStatus &&
    current.change.conflicted === target.change.conflicted &&
    current.change.submodule === target.change.submodule,
  );
}
