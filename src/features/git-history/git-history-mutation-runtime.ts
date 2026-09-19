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
}

/** Owns Git History's reviewed branch and historical-file mutation workflows. */
export class GitHistoryMutationRuntime {
  readonly branch: BranchMutationController;
  readonly fileRestore: CommitFileRestoreController;

  private readonly branchBinding: BranchMutationDialogBinding;
  private readonly fileRestoreBinding: CommitFileRestoreDialogBinding;
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
  }

  render(): void {
    this.branchBinding.render();
    this.fileRestoreBinding.render();
  }

  refreshCopy(): void {
    this.branchBinding.refreshCopy();
    this.fileRestoreBinding.refreshCopy();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.branchBinding.dispose();
    this.fileRestoreBinding.dispose();
    this.branch.dispose();
    this.fileRestore.dispose();
  }
}
