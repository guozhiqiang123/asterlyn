import type {
  CommitComparisonDiffResult,
  CommitDiffResult,
} from "../../models.ts";
import type { CommitFileView } from "../../workbench/git-presentation.ts";

const COMMIT_FILE_VIEW_KEY = "asterlyn.commitFileView.v1";

export type GitDetailMode = "branch" | "commit" | "comparison" | "folder";

export interface HistoryDetailPresentationState {
  readonly gitDetail: GitDetailMode;
  readonly commitFileView: CommitFileView;
  readonly collapsedCommitFileDirectories: ReadonlySet<string>;
  readonly commitPatch: CommitDiffResult | null;
  readonly commitPatchLoading: boolean;
  readonly commitPatchError: string | null;
  readonly commitPatchVersion: number;
  readonly comparisonPatch: CommitComparisonDiffResult | null;
  readonly comparisonPatchLoading: boolean;
  readonly comparisonPatchError: string | null;
  readonly comparisonPatchVersion: number;
}

interface MutableHistoryDetailPresentationState {
  gitDetail: GitDetailMode;
  commitFileView: CommitFileView;
  collapsedCommitFileDirectories: Set<string>;
  commitPatch: CommitDiffResult | null;
  commitPatchLoading: boolean;
  commitPatchError: string | null;
  commitPatchVersion: number;
  comparisonPatch: CommitComparisonDiffResult | null;
  comparisonPatchLoading: boolean;
  comparisonPatchError: string | null;
  comparisonPatchVersion: number;
}

export class HistoryDetailPresentationController {
  private readonly storage: Pick<Storage, "getItem" | "setItem">;
  private readonly value: MutableHistoryDetailPresentationState;
  private commitPatchGeneration = 0;
  private comparisonPatchGeneration = 0;

  constructor(storage: Pick<Storage, "getItem" | "setItem">) {
    this.storage = storage;
    this.value = {
      gitDetail: "commit",
      commitFileView: loadCommitFileView(storage),
      collapsedCommitFileDirectories: new Set(),
      commitPatch: null,
      commitPatchLoading: false,
      commitPatchError: null,
      commitPatchVersion: 0,
      comparisonPatch: null,
      comparisonPatchLoading: false,
      comparisonPatchError: null,
      comparisonPatchVersion: 0,
    };
  }

  get state(): HistoryDetailPresentationState {
    return this.value;
  }

  show(mode: GitDetailMode): void {
    this.value.gitDetail = mode;
  }

  resetWorkspace(): void {
    this.value.gitDetail = "commit";
    this.clearCommitPatch();
    this.clearComparisonPatch();
  }

  toggleFileView(): CommitFileView {
    this.value.commitFileView = this.value.commitFileView === "tree" ? "flat" : "tree";
    saveCommitFileView(this.storage, this.value.commitFileView);
    return this.value.commitFileView;
  }

  setDirectoryExpanded(path: string, expanded: boolean): void {
    if (expanded) this.value.collapsedCommitFileDirectories.delete(path);
    else this.value.collapsedCommitFileDirectories.add(path);
  }

  expandDirectories(): void {
    this.value.collapsedCommitFileDirectories.clear();
  }

  collapseDirectories(paths: Iterable<string>): void {
    this.value.collapsedCommitFileDirectories = new Set(paths);
  }

  beginCommitPatch(): number {
    const generation = ++this.commitPatchGeneration;
    this.value.commitPatch = null;
    this.value.commitPatchLoading = true;
    this.value.commitPatchError = null;
    return generation;
  }

  commitPatchIsCurrent(generation: number): boolean {
    return generation === this.commitPatchGeneration;
  }

  completeCommitPatch(generation: number, patch: CommitDiffResult | null): boolean {
    if (!this.commitPatchIsCurrent(generation)) return false;
    this.value.commitPatch = patch;
    this.value.commitPatchLoading = false;
    this.value.commitPatchError = null;
    this.value.commitPatchVersion = generation;
    return true;
  }

  failCommitPatch(generation: number, error: string): boolean {
    if (!this.commitPatchIsCurrent(generation)) return false;
    this.value.commitPatch = null;
    this.value.commitPatchLoading = false;
    this.value.commitPatchError = error;
    this.value.commitPatchVersion = generation;
    return true;
  }

  clearCommitPatch(): void {
    this.commitPatchGeneration += 1;
    this.value.collapsedCommitFileDirectories.clear();
    this.value.commitPatch = null;
    this.value.commitPatchLoading = false;
    this.value.commitPatchError = null;
  }

  beginComparisonPatch(): number {
    const generation = ++this.comparisonPatchGeneration;
    this.value.comparisonPatch = null;
    this.value.comparisonPatchLoading = true;
    this.value.comparisonPatchError = null;
    return generation;
  }

  comparisonPatchIsCurrent(generation: number): boolean {
    return generation === this.comparisonPatchGeneration;
  }

  completeComparisonPatch(
    generation: number,
    patch: CommitComparisonDiffResult | null,
  ): boolean {
    if (!this.comparisonPatchIsCurrent(generation)) return false;
    this.value.comparisonPatch = patch;
    this.value.comparisonPatchLoading = false;
    this.value.comparisonPatchError = null;
    this.value.comparisonPatchVersion = generation;
    return true;
  }

  failComparisonPatch(generation: number, error: string): boolean {
    if (!this.comparisonPatchIsCurrent(generation)) return false;
    this.value.comparisonPatch = null;
    this.value.comparisonPatchLoading = false;
    this.value.comparisonPatchError = error;
    this.value.comparisonPatchVersion = generation;
    return true;
  }

  clearComparisonPatch(): void {
    this.comparisonPatchGeneration += 1;
    this.value.comparisonPatch = null;
    this.value.comparisonPatchLoading = false;
    this.value.comparisonPatchError = null;
  }
}

function loadCommitFileView(storage: Pick<Storage, "getItem">): CommitFileView {
  try {
    return storage.getItem(COMMIT_FILE_VIEW_KEY) === "flat" ? "flat" : "tree";
  } catch {
    return "tree";
  }
}

function saveCommitFileView(
  storage: Pick<Storage, "setItem">,
  view: CommitFileView,
): void {
  try {
    storage.setItem(COMMIT_FILE_VIEW_KEY, view);
  } catch {
    // A denied preference write must not affect commit inspection.
  }
}
