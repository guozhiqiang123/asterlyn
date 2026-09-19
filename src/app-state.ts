import type {
  CommitComparisonDiffResult,
  CommitDiffResult,
} from "./models.ts";
import type { CommitFileView } from "./workbench/git-presentation.ts";
import {
  createCommandSurfaceState,
  type CommandSurfaceState,
} from "./workbench/navigation.ts";

export interface AppState {
  gitDetail: "branch" | "commit" | "comparison" | "folder";
  commandSurface: CommandSurfaceState;
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
  loading: boolean;
  error: string | null;
}

export function createAppState(commitFileView: CommitFileView): AppState {
  return {
    gitDetail: "commit",
    commandSurface: createCommandSurfaceState(),
    commitFileView,
    collapsedCommitFileDirectories: new Set(),
    commitPatch: null,
    commitPatchLoading: false,
    commitPatchError: null,
    commitPatchVersion: 0,
    comparisonPatch: null,
    comparisonPatchLoading: false,
    comparisonPatchError: null,
    comparisonPatchVersion: 0,
    loading: false,
    error: null,
  };
}
