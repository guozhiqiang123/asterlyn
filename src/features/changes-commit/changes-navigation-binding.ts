import type { FileChange, RepositorySnapshot } from "../../models.ts";
import type { WorkspaceTargetIdentity } from "../../application/workbench-navigation.ts";
import { changeGroup, type ChangeGroupId } from "./change-presentation.ts";
import { findFileChange } from "../../change-identity.ts";
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
  readonly workspacePaths: readonly string[];
}

export interface ChangesDirectoryContextTarget extends WorkspaceTargetIdentity {
  readonly kind: "directory";
  readonly workspacePath: string;
  readonly path: string;
  readonly group: ChangeGroupId;
  readonly repositoryId: string;
  readonly repositoryRevision: number;
  readonly changes: readonly FileChange[];
}

export type ChangesContextTarget = ChangesFileContextTarget | ChangesGroupContextTarget | ChangesDirectoryContextTarget;

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
      selector: "[data-change-path], [data-change-group], [data-change-directory]",
      resolve: (trigger) => {
        const path = trigger.dataset.changePath;
        const directory = trigger.dataset.changeDirectory;
        const group = trigger.dataset.changeGroup as ChangeGroupId | undefined;
        const context = current();
        const repositoryId = trigger.dataset.changeRepositoryId ?? context.repositoryId;
        if (directory && group) return resolveChangesDirectoryContextTarget(
          context.snapshot, context.workspaceGeneration, directory, group, repositoryId, context.repositoryRevision,
        );
        if (path) return resolveChangesContextTarget(
              context.snapshot,
              context.workspaceGeneration,
              path,
              repositoryId,
              context.repositoryRevision,
            );
        return group
          ? resolveChangesGroupContextTarget(
              context.snapshot,
              context.workspaceGeneration,
              group,
              repositoryId,
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
  const change = snapshot ? findFileChange(snapshot.changes, repositoryId, path) : null;
  return snapshot && change
    ? {
        workspaceRoot: snapshot.root,
        workspaceGeneration,
        workspacePath: change.workspacePath || change.path,
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
    .filter((change) => (change.repositoryId || ".") === repositoryId && changeGroup(change) === group)
    .map((change) => change.path)
    .sort();
  const workspacePaths = snapshot.changes
    .filter((change) => (change.repositoryId || ".") === repositoryId && changeGroup(change) === group)
    .map((change) => change.workspacePath || change.path)
    .sort();
  return paths.length > 0 ? {
    workspaceRoot: snapshot.root,
    workspaceGeneration,
    kind: "group",
    group,
    repositoryId,
    repositoryRevision,
    paths,
    workspacePaths,
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
  if (target.kind === "directory") {
    const current = resolveChangesDirectoryContextTarget(
      snapshot, workspaceGeneration, target.path, target.group, target.repositoryId, repositoryRevision,
    );
    return Boolean(current && current.workspacePath === target.workspacePath &&
      current.changes.length === target.changes.length &&
      current.changes.every((change, index) => sameChange(change, target.changes[index]!)));
  }
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
      current.paths.every((path, index) => path === target.paths[index]) &&
      current.workspacePaths.length === (target.workspacePaths ?? target.paths).length &&
      current.workspacePaths.every(
        (path, index) => path === (target.workspacePaths ?? target.paths)[index],
      ),
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
    current && sameChange(current.change, target.change),
  );
}

export function resolveChangesDirectoryContextTarget(
  snapshot: RepositorySnapshot | null,
  workspaceGeneration: number,
  path: string,
  group: ChangeGroupId,
  repositoryId = ".",
  repositoryRevision = 0,
): ChangesDirectoryContextTarget | null {
  if (!snapshot || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) return null;
  const root = snapshot.repositoryRoots.find((candidate) => candidate.id === repositoryId);
  if (!root) return null;
  const changes = snapshot.changes.filter((change) =>
    (change.repositoryId || ".") === repositoryId && changeGroup(change) === group &&
    change.path.startsWith(`${path}/`),
  ).map((change) => ({ ...change })).sort((left, right) => left.path.localeCompare(right.path));
  return changes.length ? {
    workspaceRoot: snapshot.root, workspaceGeneration, kind: "directory",
    workspacePath: root.relativePath === "." ? path : `${root.relativePath}/${path}`,
    path, group, repositoryId, repositoryRevision, changes,
  } : null;
}

function sameChange(left: FileChange, right: FileChange): boolean {
  return left.path === right.path && (left.workspacePath || left.path) === (right.workspacePath || right.path) &&
    left.originalPath === right.originalPath && left.indexStatus === right.indexStatus &&
    left.worktreeStatus === right.worktreeStatus && left.conflicted === right.conflicted && left.submodule === right.submodule;
}
