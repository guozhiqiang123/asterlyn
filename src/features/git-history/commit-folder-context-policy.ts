import type { HistoryQueryIntent } from "../../application/workbench-navigation.ts";
import type { ContextMenuAvailability } from "../../shared/context-menu/context-menu-model.ts";
import { defaultHistoryQuery } from "../../history-query.ts";
import type { CommitDetailDirectoryContextTarget } from "./commit-detail-context-binding.ts";

export interface CommitFolderContextPolicy {
  readonly reveal: ContextMenuAvailability;
}

export function commitFolderContextPolicy(
  currentDirectoryAvailable: boolean,
  unavailableReason: string,
): CommitFolderContextPolicy {
  return {
    reveal: currentDirectoryAvailable
      ? { kind: "enabled" }
      : { kind: "blocked", reason: unavailableReason },
  };
}

export function commitFolderHistoryIntent(
  target: CommitDetailDirectoryContextTarget,
): HistoryQueryIntent {
  return {
    workspaceRoot: target.workspaceRoot,
    workspaceGeneration: target.workspaceGeneration,
    query: {
      ...defaultHistoryQuery(),
      repositoryIds: [target.repositoryId],
      startCommit: { repositoryId: target.repositoryId, oid: target.oid },
      paths: [{ repositoryId: target.repositoryId, path: target.path }],
    },
  };
}
