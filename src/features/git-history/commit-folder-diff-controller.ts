import type { CommitFileChange } from "../../models.ts";
import type { CommitDetailDirectoryContextTarget } from "./commit-detail-context-binding.ts";

export interface CommitFolderDiffState {
  readonly target: CommitDetailDirectoryContextTarget | null;
  readonly selectedFile: string | null;
}

/** Owns the bounded read-only file range projected from one exact commit directory target. */
export class CommitFolderDiffController {
  private value: CommitFolderDiffState = { target: null, selectedFile: null };

  get state(): CommitFolderDiffState {
    return this.value;
  }

  open(target: CommitDetailDirectoryContextTarget): void {
    this.value = {
      target: cloneTarget(target),
      selectedFile: null,
    };
  }

  selectFile(path: string): CommitFileChange | null {
    const file = this.value.target?.descendants.find((candidate) => candidate.path === path) ?? null;
    if (!file) return null;
    this.value = { ...this.value, selectedFile: path };
    return { ...file };
  }

  clear(): void {
    this.value = { target: null, selectedFile: null };
  }
}

function cloneTarget(
  target: CommitDetailDirectoryContextTarget,
): CommitDetailDirectoryContextTarget {
  return {
    ...target,
    descendants: target.descendants.map((file) => ({ ...file })),
  };
}
