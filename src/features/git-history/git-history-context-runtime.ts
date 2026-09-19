import type { TextClipboardPort } from "../../application/text-clipboard.ts";
import type { HistoryCopy } from "../../localization/catalog.ts";
import type { RepositorySnapshot } from "../../models.ts";
import type { ContextMenuPort } from "../../shared/context-menu/context-menu-model.ts";
import type { CommitFileView } from "../../workbench/git-presentation.ts";
import { BranchContextActions, type BranchContextRuntime } from "./branch-context-actions.ts";
import { BranchContextBinding } from "./branch-context-binding.ts";
import {
  CommitDetailContextBinding,
  type CommitDetailDirectoryContextTarget,
  type CommitDetailFileContextTarget,
} from "./commit-detail-context-binding.ts";
import {
  CommitFileContextActions,
  type CommitFileContextRuntime,
} from "./commit-file-context-actions.ts";
import {
  CommitFolderContextActions,
  type CommitFolderContextRuntime,
} from "./commit-folder-context-actions.ts";
import type { GitHistoryDetailsState } from "./history-details-controller.ts";
import {
  HistoryCommitContextActions,
  type HistoryCommitContextRuntime,
} from "./history-commit-context-actions.ts";
import { HistoryContextBinding } from "./history-context-binding.ts";
import {
  HistoryCommitRangeContextActions,
  type HistoryCommitRangeRuntime,
} from "./history-range-context-actions.ts";
import { resolveHistoryCommitRangeTarget } from "./history-range-context.ts";
import type { HistoryRangeSelection } from "./history-range-selection.ts";

export interface GitHistoryContextSources {
  branch(): {
    readonly snapshot: RepositorySnapshot | null;
    readonly workspaceGeneration: number;
    readonly repositoryRevision: number;
    readonly selectedRepositoryIds: ReadonlySet<string>;
  };
  history(): {
    readonly state: GitHistoryDetailsState;
    readonly workspaceGeneration: number;
    readonly repositoryRevision: number;
  };
  detail(): {
    readonly state: GitHistoryDetailsState;
    readonly workspaceGeneration: number;
    readonly repositoryRevision: number;
    readonly snapshot: RepositorySnapshot | null;
    readonly fileView: CommitFileView;
  };
  rangeSelection(key: string): HistoryRangeSelection | null;
  markHistoryTarget(key: string): void;
}

export interface GitHistoryContextPorts {
  readonly branch: BranchContextRuntime;
  readonly commit: HistoryCommitContextRuntime;
  readonly range: HistoryCommitRangeRuntime;
  readonly folder: CommitFolderContextRuntime;
  readonly file: CommitFileContextRuntime;
}

export interface GitHistoryContextRuntimeOptions {
  readonly root: HTMLElement;
  readonly host: ContextMenuPort;
  readonly clipboard: TextClipboardPort;
  readonly copy: () => HistoryCopy;
  readonly sources: GitHistoryContextSources;
  readonly ports: GitHistoryContextPorts;
}

/** Owns every delegated context-menu binding on the Git History DOM boundary. */
export class GitHistoryContextRuntime {
  private readonly bindings: readonly {
    dispose(): void;
  }[];
  private disposed = false;

  constructor(options: GitHistoryContextRuntimeOptions) {
    const { root, host, clipboard, copy, sources, ports } = options;
    const branchActions = new BranchContextActions(host, clipboard, ports.branch, copy);
    const commitActions = new HistoryCommitContextActions(host, clipboard, ports.commit, copy);
    const rangeActions = new HistoryCommitRangeContextActions(host, clipboard, ports.range, copy);
    const folderActions = new CommitFolderContextActions(host, clipboard, ports.folder, copy);
    const fileActions = new CommitFileContextActions(host, clipboard, ports.file, copy);

    this.bindings = [
      new BranchContextBinding(root, sources.branch, (request) => branchActions.open(request)),
      new HistoryContextBinding(root, sources.history, (request) => {
        const range = resolveHistoryCommitRangeTarget(
          request.target,
          sources.rangeSelection(request.target.key),
        );
        if (!range) return commitActions.open(request);
        sources.markHistoryTarget(request.target.key);
        return rangeActions.open({ ...request, target: range });
      }),
      new CommitDetailContextBinding(root, sources.detail, (request) =>
        request.target.kind === "directory"
          ? folderActions.open({
              ...request,
              target: request.target as CommitDetailDirectoryContextTarget,
            })
          : fileActions.open({
              ...request,
              target: request.target as CommitDetailFileContextTarget,
            })
      ),
    ];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const binding of this.bindings) binding.dispose();
  }
}
