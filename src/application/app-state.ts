import type { HistoryFilterMenu } from "../features/git-history/history-navigation-view.ts";
import {
  createHistoryFilterState,
  type HistoryFilterState,
} from "../features/git-history/history-filter-controller.ts";
import type {
  BranchSummary,
  CommitDiffResult,
  HistoryPath,
  HistoryRef,
} from "../models.ts";
import type { CommitFileView } from "../workbench/git-presentation.ts";
import {
  createCommandSurfaceState,
  type CommandSurfaceState,
} from "../workbench/navigation.ts";
import {
  createWorkspaceReplacementState,
  type WorkspaceReplacementState,
} from "../workbench/workspace-replacement.ts";
import {
  createWorkspaceSearchControls,
  createWorkspaceSearchState,
  type WorkspaceSearchControls,
  type WorkspaceSearchState,
} from "../workbench/workspace-search.ts";

export interface AppState extends HistoryFilterState {
  gitDetail: "branch" | "commit";
  commandSurface: CommandSurfaceState;
  workspaceSearch: WorkspaceSearchState;
  workspaceSearchControls: WorkspaceSearchControls;
  workspaceReplacement: WorkspaceReplacementState;
  replacementText: string;
  replacementDialog: "preview" | "recovery" | null;
  replacementRecoveryBusy: { id: string; action: "keep" | "rollback" } | null;
  historyQuery: string;
  historyCaseSensitive: boolean;
  historyRegularExpression: boolean;
  historyFilterMenu: HistoryFilterMenu | null;
  historyBranchSubmenu: string | null;
  historyDialog: "branches" | "paths-text" | "paths-tree" | null;
  historyDialogQuery: string;
  historyDialogError: string | null;
  historyRefDraft: Map<string, HistoryRef>;
  historyPathDraft: Map<string, HistoryPath>;
  historyPathText: string;
  historyTreeCollapsed: Set<string>;
  branchQuery: string;
  commitFileView: CommitFileView;
  collapsedCommitFileDirectories: Set<string>;
  commitPatch: CommitDiffResult | null;
  commitPatchLoading: boolean;
  commitPatchError: string | null;
  commitPatchVersion: number;
  selectedBranch: string | null;
  collapsedBranchGroups: Set<BranchSummary["kind"]>;
  newBranchName: string;
  loading: boolean;
  error: string | null;
}

export function createAppState(commitFileView: CommitFileView): AppState {
  return {
    gitDetail: "commit",
    commandSurface: createCommandSurfaceState(),
    workspaceSearch: createWorkspaceSearchState(),
    workspaceSearchControls: createWorkspaceSearchControls(),
    workspaceReplacement: createWorkspaceReplacementState(),
    replacementText: "",
    replacementDialog: null,
    replacementRecoveryBusy: null,
    ...createHistoryFilterState(),
    historyQuery: "",
    historyCaseSensitive: false,
    historyRegularExpression: false,
    historyFilterMenu: null,
    historyBranchSubmenu: null,
    historyDialog: null,
    historyDialogQuery: "",
    historyDialogError: null,
    historyRefDraft: new Map(),
    historyPathDraft: new Map(),
    historyPathText: "",
    historyTreeCollapsed: new Set(),
    branchQuery: "",
    commitFileView,
    collapsedCommitFileDirectories: new Set(),
    commitPatch: null,
    commitPatchLoading: false,
    commitPatchError: null,
    commitPatchVersion: 0,
    selectedBranch: null,
    collapsedBranchGroups: new Set(),
    newBranchName: "",
    loading: false,
    error: null,
  };
}
