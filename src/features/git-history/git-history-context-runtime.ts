import type { TextClipboardPort } from "../../application/text-clipboard.ts";
import type {
  BranchContextCommandAction,
  HistoryContextCommandAction,
} from "../../application/commands/history-command-ids.ts";
import type { HistoryCopy } from "../../localization/catalog.ts";
import type { RepositorySnapshot } from "../../models.ts";
import type { ContextMenuPort } from "../../shared/context-menu/context-menu-model.ts";
import type { CommitFileView } from "../../presentation/git-presentation.ts";
import { TopbarBranchMenuBinding } from "./topbar-branch-menu.ts";
import { BranchContextActions, type BranchContextRuntime } from "./branch-context-actions.ts";
import {
  BranchContextBinding,
  resolveBranchContextTarget,
  type BranchContextTarget,
} from "./branch-context-binding.ts";
import {
  CommitDetailContextBinding,
  resolveCommitDetailContextTarget,
  type CommitDetailContextTarget,
  type CommitDetailDirectoryContextTarget,
  type CommitDetailFileContextTarget,
} from "./commit-detail-context-binding.ts";
import {
  CommitFileContextActions,
  type CommitFileCommandAction,
  type CommitFileContextRuntime,
} from "./commit-file-context-actions.ts";
import {
  CommitFolderContextActions,
  type CommitFolderCommandAction,
  type CommitFolderContextRuntime,
} from "./commit-folder-context-actions.ts";
import type { GitHistoryDetailsState } from "./history-details-controller.ts";
import {
  HistoryCommitContextActions,
  type HistoryCommitContextRuntime,
} from "./history-commit-context-actions.ts";
import { HistoryContextBinding } from "./history-context-binding.ts";
import { resolveHistoryCommitContextTarget } from "./history-context-binding.ts";
import {
  HistoryCommitRangeContextActions,
  type HistoryCommitRangeRuntime,
} from "./history-range-context-actions.ts";
import { resolveHistoryCommitRangeTarget, type HistoryCommitRangeTarget } from "./history-range-context.ts";
import type { HistoryRangeSelection } from "./history-range-selection.ts";

export interface GitHistoryContextSources {
  branch(): {
    readonly snapshot: RepositorySnapshot | null;
    readonly workspaceGeneration: number;
    readonly repositoryRevision: number;
    readonly selectedRepositoryIds: ReadonlySet<string>;
    readonly selectedBranchKey: string | null;
  };
  history(): {
    readonly state: GitHistoryDetailsState;
    readonly workspaceGeneration: number;
    readonly repositoryRevision: number;
    readonly visible: boolean;
  };
  detail(): {
    readonly state: GitHistoryDetailsState;
    readonly workspaceGeneration: number;
    readonly repositoryRevision: number;
    readonly snapshot: RepositorySnapshot | null;
    readonly fileView: CommitFileView;
  };
  rangeSelection(key: string): HistoryRangeSelection | null;
  currentRangeSelection(): HistoryRangeSelection | null;
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
  readonly manageRemotes: () => void;
  readonly loadMoreHistory: () => void | Promise<void>;
  readonly unavailableReason: () => string;
}

/** Owns every delegated context-menu binding on the Git History DOM boundary. */
export class GitHistoryContextRuntime {
  private readonly bindings: readonly {
    dispose(): void;
  }[];
  private readonly root: HTMLElement;
  private readonly copy: () => HistoryCopy;
  private readonly sources: GitHistoryContextSources;
  private readonly branchActions: BranchContextActions;
  private readonly rangeActions: HistoryCommitRangeContextActions;
  private readonly folderActions: CommitFolderContextActions;
  private readonly fileActions: CommitFileContextActions;
  private readonly loadMoreHistory: () => void | Promise<void>;
  private readonly unavailableReason: () => string;
  private disposed = false;

  constructor(options: GitHistoryContextRuntimeOptions) {
    const { root, host, clipboard, copy, sources, ports } = options;
    this.root = root;
    this.copy = copy;
    this.sources = sources;
    this.loadMoreHistory = options.loadMoreHistory;
    this.unavailableReason = options.unavailableReason;
    this.branchActions = new BranchContextActions(host, clipboard, ports.branch, copy);
    const commitActions = new HistoryCommitContextActions(host, clipboard, ports.commit, copy);
    this.rangeActions = new HistoryCommitRangeContextActions(host, clipboard, ports.range, copy);
    this.folderActions = new CommitFolderContextActions(host, clipboard, ports.folder, copy);
    this.fileActions = new CommitFileContextActions(host, clipboard, ports.file, copy);

    this.bindings = [
      new BranchContextBinding(root, sources.branch, (request) => this.branchActions.open(request)),
      new TopbarBranchMenuBinding(root, host, this.branchActions, sources.branch, copy, options.manageRemotes),
      new HistoryContextBinding(root, sources.history, (request) => {
        const range = resolveHistoryCommitRangeTarget(
          request.target,
          sources.rangeSelection(request.target.key),
        );
        if (!range) return commitActions.open(request);
        sources.markHistoryTarget(request.target.key);
        return this.rangeActions.open({ ...request, target: range });
      }),
      new CommitDetailContextBinding(root, sources.detail, (request) =>
        request.target.kind === "directory"
          ? this.folderActions.open({
              ...request,
              target: request.target as CommitDetailDirectoryContextTarget,
            })
          : this.fileActions.open({
              ...request,
              target: request.target as CommitDetailFileContextTarget,
            })
      ),
    ];
  }

  commandAvailability(action: HistoryContextCommandAction): { enabled: boolean; reason?: string } {
    if (!this.sources.history().visible) {
      return { enabled: false, reason: this.unavailableReason() };
    }
    if (action === "load-more") {
      const state = this.sources.history().state;
      if (state.history.status === "ready" && state.hasMore && !state.loadingMore && !state.refreshing) {
        return { enabled: true };
      }
      return {
        enabled: false,
        reason: state.loadingMore || state.refreshing
          ? this.copy().loadingOlderCommits
          : this.copy().noOlderCommits,
      };
    }
    const target = this.commandTarget(action);
    if (!target) return { enabled: false, reason: this.copy().commitHistory };
    const availability = isBranchCommand(action)
      ? this.branchActions.commandAvailability(action, target as BranchContextTarget)
      : action === "compare-selection"
      ? this.rangeActions.commandAvailability(target as HistoryCommitRangeTarget)
      : action.startsWith("file-")
        ? this.fileActions.commandAvailability(
            action.slice("file-".length) as CommitFileCommandAction,
            target as CommitDetailFileContextTarget,
          )
        : this.folderActions.commandAvailability(
            action.slice("folder-".length) as CommitFolderCommandAction,
            target as CommitDetailDirectoryContextTarget,
          );
    return availability.kind === "enabled"
      ? { enabled: true }
      : {
          enabled: false,
          reason: availability.kind === "busy" ? availability.label : availability.reason,
        };
  }

  async executeCommand(action: HistoryContextCommandAction): Promise<void> {
    const availability = this.commandAvailability(action);
    if (!availability.enabled) return;
    if (action === "load-more") { await this.loadMoreHistory(); return; }
    const target = this.commandTarget(action);
    if (!target) return;
    if (isBranchCommand(action)) {
      this.branchActions.executeCommand(action, target as BranchContextTarget);
    } else if (action === "compare-selection") {
      this.rangeActions.executeCompareCommand(target as HistoryCommitRangeTarget);
    } else if (action.startsWith("file-")) {
      this.fileActions.executeCommand(
        action.slice("file-".length) as CommitFileCommandAction,
        target as CommitDetailFileContextTarget,
      );
    } else {
      this.folderActions.executeCommand(
        action.slice("folder-".length) as CommitFolderCommandAction,
        target as CommitDetailDirectoryContextTarget,
      );
    }
  }

  renderTopbarBranch(snapshot: RepositorySnapshot | null): void {
    (this.bindings.find((binding) => binding instanceof TopbarBranchMenuBinding) as TopbarBranchMenuBinding | undefined)?.render(snapshot);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const binding of this.bindings) binding.dispose();
  }

  private commandTarget(
    action: Exclude<HistoryContextCommandAction, "load-more">,
  ): BranchContextTarget | CommitDetailContextTarget | HistoryCommitRangeTarget | null {
    if (isBranchCommand(action)) {
      const source = this.sources.branch();
      return source.selectedBranchKey
        ? resolveBranchContextTarget(
            source.snapshot, source.workspaceGeneration, source.repositoryRevision,
            source.selectedRepositoryIds, source.selectedBranchKey,
          )
        : null;
    }
    if (action === "compare-selection") {
      const source = this.sources.history();
      const selection = this.sources.currentRangeSelection();
      const key = selection?.activeKey ?? source.state.selectedCommit;
      const row = key
        ? resolveHistoryCommitContextTarget(
            source.state,
            source.workspaceGeneration,
            source.repositoryRevision,
            key,
          )
        : null;
      return row ? resolveHistoryCommitRangeTarget(row, selection) : null;
    }
    const source = this.sources.detail();
    const kind = action.startsWith("file-") ? "file" : "directory";
    const path = kind === "file"
      ? source.state.selectedFile
      : this.root.querySelector<HTMLElement>("[data-commit-file-directory] > summary:focus")
          ?.parentElement?.dataset.commitFileDirectory ?? null;
    return path
      ? resolveCommitDetailContextTarget(
          source.state,
          source.workspaceGeneration,
          kind,
          path,
          source.snapshot,
          source.repositoryRevision,
          source.fileView,
        )
      : null;
  }
}

function isBranchCommand(
  action: HistoryContextCommandAction,
): action is BranchContextCommandAction {
  return action === "ref-history" || action.startsWith("branch-") || action.startsWith("tag-");
}
