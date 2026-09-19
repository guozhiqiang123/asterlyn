import type { HistoryQueryIntent } from "../../application/workbench-navigation.ts";
import type { ContextMenuAvailability } from "../../shared/context-menu/context-menu-model.ts";
import { defaultHistoryQuery } from "../../history-query.ts";
import type { CommitDetailFileContextTarget } from "./commit-detail-context-binding.ts";

export interface CommitFileContextPolicy {
  readonly currentFile: ContextMenuAvailability;
  readonly restore: ContextMenuAvailability;
}

export interface CommitFileContextPolicyOptions {
  readonly currentFileAvailable: boolean;
  readonly currentFileUnavailableReason: string;
  readonly restoreBlockedReason: string | null;
  readonly busy: boolean;
  readonly busyReason: string;
}

export function commitFileContextPolicy(
  options: CommitFileContextPolicyOptions,
): CommitFileContextPolicy {
  const currentFile = options.currentFileAvailable
    ? { kind: "enabled" } as const
    : { kind: "blocked", reason: options.currentFileUnavailableReason } as const;
  const restore = options.busy
    ? { kind: "blocked", reason: options.busyReason } as const
    : options.restoreBlockedReason
      ? { kind: "blocked", reason: options.restoreBlockedReason } as const
      : { kind: "enabled" } as const;
  return { currentFile, restore };
}

export function commitFileHistoryIntent(
  target: CommitDetailFileContextTarget,
): HistoryQueryIntent {
  const paths = [target.file.path];
  if (target.file.originalPath && target.file.originalPath !== target.file.path) {
    paths.push(target.file.originalPath);
  }
  return {
    workspaceRoot: target.workspaceRoot,
    workspaceGeneration: target.workspaceGeneration,
    query: {
      ...defaultHistoryQuery(),
      repositoryIds: [target.repositoryId],
      startCommit: { repositoryId: target.repositoryId, oid: target.oid },
      paths: paths.map((path) => ({ repositoryId: target.repositoryId, path })),
    },
  };
}
