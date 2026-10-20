import type { HistoryQueryIntent } from "../../application/workbench-navigation.ts";
import { commitKey, defaultHistoryQuery } from "../../history-query.ts";
import type { RepositorySnapshot } from "../../models.ts";
import type { GitBlameSource } from "./editor-gutter.ts";

export interface GitBlameHistoryTarget {
  readonly intent: HistoryQueryIntent;
  readonly commitKey: string;
}

export function gitBlameHistoryTarget(
  source: GitBlameSource,
  oid: string,
  snapshot: RepositorySnapshot | null,
  workspaceGeneration: number,
): GitBlameHistoryTarget | null {
  if (
    !snapshot ||
    snapshot.root !== source.repositoryRoot ||
    !snapshot.repositoryRoots.some((repository) => repository.id === source.repositoryId) ||
    !/^[0-9a-f]{40}$/iu.test(oid)
  ) return null;
  const startCommit = { repositoryId: source.repositoryId, oid: oid.toLowerCase() };
  return {
    intent: {
      workspaceRoot: snapshot.root,
      workspaceGeneration,
      query: {
        ...defaultHistoryQuery(),
        repositoryIds: [source.repositoryId],
        startCommit,
      },
    },
    commitKey: commitKey(startCommit),
  };
}
