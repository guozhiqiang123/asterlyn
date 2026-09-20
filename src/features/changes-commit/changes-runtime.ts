import type { FileChange } from "../../models.ts";
import type { ChangesCopy, CommonCopy } from "../../localization/catalog.ts";
import type { ChangeFileView } from "./change-presentation.ts";
import {
  ChangesCommitController,
  type ChangesCommitChange,
  type ChangesCommitGateway,
} from "./changes-commit-controller.ts";
import { ChangesRestoreReviewController } from "./changes-restore-review-controller.ts";
import { ChangesRestoreReviewDialogBinding } from "./changes-restore-review-dialog-binding.ts";

export interface ChangesRuntimeOptions {
  readonly gateway: ChangesCommitGateway;
  readonly initialFileView: ChangeFileView;
  readonly messages: Pick<ChangesCopy, "patchTruncated" | "unexpectedError">;
  readonly root: HTMLElement;
  copy(): ChangesCopy & Pick<CommonCopy, "cancel">;
  changed(change: ChangesCommitChange): void;
}

/** Owns the Changes controller subscription and lifecycle. */
export class ChangesRuntime {
  readonly controller: ChangesCommitController;
  readonly restoreReview = new ChangesRestoreReviewController();

  private readonly release: () => void;
  private readonly restoreReviewBinding: ChangesRestoreReviewDialogBinding;
  private disposed = false;

  constructor(options: ChangesRuntimeOptions) {
    this.controller = new ChangesCommitController(
      options.gateway,
      options.initialFileView,
      options.messages,
    );
    this.release = this.controller.subscribe((change) => options.changed(change));
    this.restoreReviewBinding = new ChangesRestoreReviewDialogBinding(
      options.root,
      this.restoreReview,
      options.copy,
    );
  }

  reviewRestore(change: FileChange): Promise<boolean> {
    return this.restoreReview.request(change);
  }

  refreshCopy(): void {
    this.restoreReviewBinding.refreshCopy();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.restoreReviewBinding.dispose();
    this.restoreReview.dispose();
    this.controller.dispose();
  }
}
