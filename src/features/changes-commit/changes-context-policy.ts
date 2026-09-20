import type { HistoryQueryIntent } from "../../application/workbench-navigation.ts";
import type { RepositorySnapshot } from "../../models.ts";
import type { ContextMenuAvailability } from "../../shared/context-menu/context-menu-model.ts";
import { defaultHistoryQuery } from "../../history-query.ts";
import type { ChangesFileContextTarget } from "./changes-navigation-binding.ts";

export interface ChangesContextPolicyReasons {
  readonly conflictsStayIncluded: string;
  readonly sourceDeleted: string;
  readonly sourceUnavailable: string;
  readonly conflictUnavailable: string;
  readonly restoreUnavailable: string;
  readonly mutationBusy: string;
  readonly operationsUnavailable: string;
  readonly noHistory: string;
}

export interface ChangesContextPolicy {
  readonly include: ContextMenuAvailability;
  readonly source: ContextMenuAvailability;
  readonly conflict: ContextMenuAvailability;
  readonly restore: ContextMenuAvailability;
  readonly trash: ContextMenuAvailability;
  readonly history: ContextMenuAvailability;
}

export interface ChangesContextPolicyOptions {
  readonly snapshot: RepositorySnapshot | null;
  readonly sourceAvailable: boolean;
  readonly conflictAvailable: boolean;
  readonly mutationBusy: boolean;
  readonly trashAvailable: boolean;
  readonly reasons: ChangesContextPolicyReasons;
}

export function changesContextPolicy(
  target: ChangesFileContextTarget,
  options: ChangesContextPolicyOptions,
): ChangesContextPolicy {
  const mutation = options.mutationBusy
    ? busy(options.reasons.mutationBusy)
    : enabled();
  const include = target.change.conflicted
    ? blocked(options.reasons.conflictsStayIncluded)
    : mutation;
  const source = changeDeleted(target)
    ? blocked(options.reasons.sourceDeleted)
    : options.sourceAvailable
      ? enabled()
      : blocked(options.reasons.sourceUnavailable);
  const conflict = options.conflictAvailable
    ? enabled()
    : blocked(options.reasons.conflictUnavailable);
  const restore = !changeSupportsRestore(options.snapshot, target)
    ? blocked(options.reasons.restoreUnavailable)
    : mutation;
  const trash = options.mutationBusy
    ? busy(options.reasons.mutationBusy)
    : options.trashAvailable
      ? enabled()
      : blocked(options.reasons.operationsUnavailable);
  const history = changesHistoryIntent(target, options.snapshot)
    ? enabled()
    : blocked(options.reasons.noHistory);
  return { include, source, conflict, restore, trash, history };
}

export function changesHistoryIntent(
  target: ChangesFileContextTarget,
  snapshot: RepositorySnapshot | null,
): HistoryQueryIntent | null {
  if (!snapshot || snapshot.root !== target.workspaceRoot || !changeHasHistory(target)) return null;
  const query = defaultHistoryQuery();
  query.repositoryIds = [target.repositoryId];
  query.paths = Array.from(new Set([target.path, target.change.originalPath].filter(
    (path): path is string => Boolean(path),
  ))).map((path) => ({ repositoryId: target.repositoryId, path }));
  return {
    workspaceRoot: target.workspaceRoot,
    workspaceGeneration: target.workspaceGeneration,
    query,
  };
}

export function changeIsUntracked(target: ChangesFileContextTarget): boolean {
  return target.change.worktreeStatus === "untracked" || target.change.indexStatus === "untracked";
}

function changeHasHistory(target: ChangesFileContextTarget): boolean {
  const change = target.change;
  return !changeIsUntracked(target) && change.indexStatus !== "added" &&
    change.worktreeStatus !== "added" && change.indexStatus !== "copied";
}

function changeDeleted(target: ChangesFileContextTarget): boolean {
  return target.change.worktreeStatus === "deleted" || (
    target.change.indexStatus === "deleted" && target.change.worktreeStatus === "unmodified"
  );
}

function changeSupportsRestore(
  snapshot: RepositorySnapshot | null,
  target: ChangesFileContextTarget,
): boolean {
  const change = target.change;
  return Boolean(
    snapshot && !snapshot.branch.unborn && !change.conflicted && !change.submodule &&
    !changeIsUntracked(target) && change.indexStatus !== "copied"
  );
}

function enabled(): ContextMenuAvailability {
  return { kind: "enabled" };
}

function blocked(reason: string): ContextMenuAvailability {
  return { kind: "blocked", reason };
}

function busy(label: string): ContextMenuAvailability {
  return { kind: "busy", label };
}
