import type {
  BranchMutationCopy,
  HistoryCommitFileContextMenuCopy,
} from "../../localization/catalog.ts";
import { BranchMutationController, type BranchMutationGateway } from "./branch-mutation-controller.ts";
import { BranchMutationDialogBinding } from "./branch-mutation-dialog-binding.ts";
import {
  CommitFileRestoreController,
  type CommitFileRestoreGateway,
} from "./commit-file-restore-controller.ts";
import { CommitFileRestoreDialogBinding } from "./commit-file-restore-dialog-binding.ts";
import type { GitResetCopy } from "../../localization/git-reviewed-copy.ts";
import { GitResetBinding } from "./git-reset-binding.ts";
import { GitResetController, type GitResetGateway } from "./git-reset-controller.ts";

export interface GitHistoryMutationRuntimeOptions {
  readonly root: HTMLElement;
  readonly branch: {
    readonly gateway: BranchMutationGateway;
    readonly copy: () => BranchMutationCopy;
  };
  readonly fileRestore: {
    readonly gateway: CommitFileRestoreGateway;
    readonly copy: () => HistoryCommitFileContextMenuCopy;
    readonly changed?: () => void;
  };
  readonly reset?: { readonly gateway: GitResetGateway; readonly copy: () => GitResetCopy };
}

/** Owns Git History's reviewed branch and historical-file mutation workflows. */
export class GitHistoryMutationRuntime {
  readonly branch: BranchMutationController;
  readonly fileRestore: CommitFileRestoreController;
  readonly reset: GitResetController | null;

  private readonly branchBinding: BranchMutationDialogBinding;
  private readonly fileRestoreBinding: CommitFileRestoreDialogBinding;
  private readonly resetBinding: GitResetBinding | null;
  private disposed = false;

  constructor(options: GitHistoryMutationRuntimeOptions) {
    this.branch = new BranchMutationController(options.branch.gateway);
    this.branchBinding = new BranchMutationDialogBinding(
      options.root,
      this.branch,
      options.branch.copy,
    );
    this.fileRestore = new CommitFileRestoreController(options.fileRestore.gateway);
    this.fileRestoreBinding = new CommitFileRestoreDialogBinding(
      options.root,
      this.fileRestore,
      options.fileRestore.copy,
      options.fileRestore.changed,
    );
    this.reset = options.reset ? new GitResetController(options.reset.gateway) : null;
    this.resetBinding = this.reset && options.reset
      ? new GitResetBinding(options.root, this.reset, options.reset.copy)
      : null;
  }

  render(): void {
    this.branchBinding.render();
    this.fileRestoreBinding.render();
    this.resetBinding?.render();
  }

  refreshCopy(): void {
    this.branchBinding.refreshCopy();
    this.fileRestoreBinding.refreshCopy();
    this.resetBinding?.refreshCopy();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.branchBinding.dispose();
    this.fileRestoreBinding.dispose();
    this.resetBinding?.dispose();
    this.branch.dispose();
    this.fileRestore.dispose();
    this.reset?.dispose();
  }
}
