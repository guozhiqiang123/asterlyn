import type {
  CommitDetails,
  CommitDiffResult,
  CommitSelectedResult,
  DiffResult,
  FileChange,
  GitConflictContent,
  GitOperationAction,
  GitOperationKind,
  GitOperationMutationOutcome,
  GitOperationPlan,
  GitOperationSnapshot,
  HistoryPage,
  HistoryQuery,
  ImageDiffPreview,
  ImagePreview,
  OpenedProject,
  ProjectFileList,
  PushMode,
  PushPreview,
  PushTagMode,
  ReplacementApplyResult,
  ReplacementRecoverySummary,
  RepositoryMutationOutcome,
  SaveTextFileResult,
  TextFileSnapshot,
  TrackedChangeScan,
  WorkingTreeMutationOutcome,
  UntrackedScan,
  WorkspaceReplacementPreview,
  WorkspaceTextSearchOptions,
  WorkspaceTextSearchReport,
} from "../models";
import type { WindowChromeMode } from "../workbench/window-chrome";

export type DirectoryChoice =
  | { kind: "selected"; path: string }
  | { kind: "cancelled" }
  | { kind: "unsupported" };

export interface DesktopShellBridge {
  readonly isDemo: boolean;
  windowChromeMode(): Promise<WindowChromeMode>;
  initialRepository(): Promise<string | null>;
  chooseRepositoryDirectory(defaultPath: string | null): Promise<DirectoryChoice>;
  openProject(path: string): Promise<OpenedProject>;
  openRepositoryWindow(path: string): Promise<string>;
}

export interface WorkspaceBridge {
  listProjectFiles(repositoryRoot: string): Promise<ProjectFileList>;
  searchWorkspaceText(
    repositoryRoot: string,
    requestId: string,
    query: string,
    options: WorkspaceTextSearchOptions,
  ): Promise<WorkspaceTextSearchReport>;
  cancelWorkspaceTextSearch(repositoryRoot: string, requestId: string): Promise<void>;
  previewWorkspaceReplacement(
    repositoryRoot: string,
    planId: string,
    query: string,
    replacement: string,
    options: WorkspaceTextSearchOptions,
  ): Promise<WorkspaceReplacementPreview>;
  applyWorkspaceReplacement(
    repositoryRoot: string,
    planId: string,
    selectedPaths: string[],
  ): Promise<ReplacementApplyResult>;
  cancelWorkspaceReplacement(repositoryRoot: string, operationId: string): Promise<void>;
  listWorkspaceReplacementRecoveries(
    repositoryRoot: string,
  ): Promise<ReplacementRecoverySummary[]>;
  rollbackWorkspaceReplacement(
    repositoryRoot: string,
    recoveryId: string,
  ): Promise<ReplacementApplyResult>;
  finalizeWorkspaceReplacement(repositoryRoot: string, recoveryId: string): Promise<void>;
  readTextFile(
    repositoryRoot: string,
    repositoryId: string,
    path: string,
  ): Promise<TextFileSnapshot>;
  saveTextFile(
    repositoryRoot: string,
    repositoryId: string,
    path: string,
    expectedRevision: string,
    content: string,
    utf8Bom: boolean,
    requestId: string,
  ): Promise<SaveTextFileResult>;
  readImageFile(
    repositoryRoot: string,
    repositoryId: string,
    path: string,
  ): Promise<ImagePreview>;
}

export interface GitReadBridge {
  readTrackedChanges(repositoryRoot: string): Promise<TrackedChangeScan>;
  readHistoryPage(
    repositoryRoot: string,
    query: HistoryQuery,
    offset: number,
    limit: number,
  ): Promise<HistoryPage>;
  scanUntracked(repositoryRoot: string, scanId: string): Promise<UntrackedScan>;
  cancelUntrackedScan(scanId: string): Promise<void>;
  readDiff(repositoryRoot: string, path: string, staged: boolean): Promise<DiffResult>;
  readLocalDiff(
    repositoryRoot: string,
    selected: FileChange,
    expandedUnchanged?: boolean,
  ): Promise<DiffResult>;
  readLocalImageDiff(
    repositoryRoot: string,
    selected: FileChange,
  ): Promise<ImageDiffPreview>;
  readCommitDetails(
    repositoryRoot: string,
    repositoryId: string,
    commitOid: string,
  ): Promise<CommitDetails>;
  readCommitDiff(
    repositoryRoot: string,
    repositoryId: string,
    commitOid: string,
    path: string,
    originalPath: string | null,
    expandedUnchanged?: boolean,
  ): Promise<CommitDiffResult>;
  readCommitImageDiff(
    repositoryRoot: string,
    repositoryId: string,
    commitOid: string,
    path: string,
    originalPath: string | null,
  ): Promise<ImageDiffPreview>;
  readPushPreview(
    repositoryRoot: string,
    remote: string,
    tagMode: PushTagMode,
    offset: number,
    pageSize: number,
  ): Promise<PushPreview>;
  readPushFileCommit(
    repositoryRoot: string,
    remote: string,
    tagMode: PushTagMode,
    previewToken: string,
    path: string,
  ): Promise<CommitDetails | null>;
}

export interface GitOperationBridge {
  stagePaths(repositoryRoot: string, paths: string[]): Promise<WorkingTreeMutationOutcome>;
  unstagePaths(repositoryRoot: string, paths: string[]): Promise<WorkingTreeMutationOutcome>;
  commitChanges(
    repositoryRoot: string,
    message: string,
    selected: FileChange[],
  ): Promise<CommitSelectedResult>;
  revertChanges(
    repositoryRoot: string,
    selected: FileChange[],
  ): Promise<WorkingTreeMutationOutcome>;
  switchBranch(repositoryRoot: string, targetFullName: string): Promise<RepositoryMutationOutcome>;
  createBranch(repositoryRoot: string, name: string): Promise<RepositoryMutationOutcome>;
  fetchRemote(
    repositoryRoot: string,
    remote: string,
    operationId: string,
  ): Promise<RepositoryMutationOutcome>;
  pullCurrent(repositoryRoot: string, operationId: string): Promise<RepositoryMutationOutcome>;
  pushCurrent(
    repositoryRoot: string,
    remote: string,
    mode: PushMode,
    tagMode: PushTagMode,
    previewToken: string,
    operationId: string,
  ): Promise<RepositoryMutationOutcome>;
  cancelRemoteOperation(repositoryRoot: string, operationId: string): Promise<void>;
  readGitOperation(repositoryRoot: string): Promise<GitOperationSnapshot | null>;
  prepareGitOperation(
    repositoryRoot: string,
    kind: GitOperationKind,
    targetRefs: string[],
    message: string | null,
  ): Promise<GitOperationPlan>;
  executeGitOperation(
    repositoryRoot: string,
    plan: GitOperationPlan,
  ): Promise<RepositoryMutationOutcome>;
  runGitOperationAction(
    repositoryRoot: string,
    action: GitOperationAction,
  ): Promise<RepositoryMutationOutcome>;
  readConflictContent(repositoryRoot: string, path: string): Promise<GitConflictContent>;
  resolveConflict(
    repositoryRoot: string,
    path: string,
    expectedRevisionToken: string,
    content: string | null,
  ): Promise<GitOperationMutationOutcome>;
}

export type DesktopBridge = DesktopShellBridge & WorkspaceBridge & GitReadBridge & GitOperationBridge;
