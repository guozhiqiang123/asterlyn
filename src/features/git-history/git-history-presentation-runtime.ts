import { CommitFolderDiffController } from "./commit-folder-diff-controller.ts";
import {
  GitBranchesController,
  type GitBranchesActions,
} from "./git-branches-controller.ts";
import { HistoryDetailPresentationController } from "./history-detail-presentation-controller.ts";
import { HistoryFilterController } from "./history-filter-controller.ts";
import { HistoryRangeSelectionController } from "./history-range-selection.ts";

/** Owns Git History's synchronous presentation and selection state. */
export class GitHistoryPresentationRuntime {
  readonly filters: HistoryFilterController;
  readonly detail: HistoryDetailPresentationController;
  readonly rangeSelection = new HistoryRangeSelectionController();
  readonly folderDiff = new CommitFolderDiffController();
  readonly branches: GitBranchesController;

  constructor(storage: Storage, branchActions: GitBranchesActions) {
    this.filters = new HistoryFilterController(storage);
    this.detail = new HistoryDetailPresentationController(storage);
    this.branches = new GitBranchesController(branchActions);
  }

  get filterState() {
    return this.filters.state;
  }

  get detailState() {
    return this.detail.state;
  }

  resetWorkspace(): void {
    this.filters.resetWorkspace();
    this.detail.resetWorkspace();
    this.rangeSelection.clear();
    this.folderDiff.clear();
    this.branches.setSelectedBranch(null);
  }
}
