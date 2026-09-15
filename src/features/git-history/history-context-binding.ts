import type { CommitSummary } from "../../models.ts";
import type { CommitIdentity } from "../../application/workbench-navigation.ts";
import { commitKey } from "../../workbench/history-identity.ts";
import type { GitHistoryDetailsState } from "./history-details-controller.ts";
import {
  DelegatedContextBinding,
  type DelegatedContextRequest,
} from "../../shared/context-menu/delegated-context-binding.ts";

export interface HistoryCommitContextTarget extends CommitIdentity {
  readonly historyGeneration: number;
  readonly key: string;
  readonly commit: CommitSummary;
}

export class HistoryContextBinding {
  private readonly binding: DelegatedContextBinding<HistoryCommitContextTarget>;

  constructor(
    root: HTMLElement,
    current: () => {
      readonly state: GitHistoryDetailsState;
      readonly workspaceGeneration: number;
    },
    open: (request: DelegatedContextRequest<HistoryCommitContextTarget>) => boolean,
  ) {
    this.binding = new DelegatedContextBinding(root, {
      selector: "[data-commit-key]",
      resolve: (trigger) => {
        const key = trigger.dataset.commitKey;
        const context = current();
        return key
          ? resolveHistoryCommitContextTarget(
              context.state,
              context.workspaceGeneration,
              key,
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

export function resolveHistoryCommitContextTarget(
  state: GitHistoryDetailsState,
  workspaceGeneration: number,
  key: string,
): HistoryCommitContextTarget | null {
  const root = state.history.root;
  const commit = state.history.commits.find((candidate) => commitKey(candidate) === key);
  return root && commit
    ? {
        workspaceRoot: root,
        workspaceGeneration,
        repositoryId: commit.repositoryId,
        oid: commit.oid,
        historyGeneration: state.history.generation,
        key,
        commit: { ...commit, parents: [...commit.parents], decorations: [...commit.decorations] },
      }
    : null;
}
