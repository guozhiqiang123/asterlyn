export type ChangeKind =
  | "unmodified"
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typeChanged"
  | "unmerged"
  | "untracked"
  | "ignored"
  | "unknown";

export interface BranchState {
  head: string | null;
  oid: string | null;
  upstream: string | null;
  upstreamRemote: string | null;
  upstreamRef: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
  unborn: boolean;
}

export interface RemoteSummary {
  name: string;
  fetchSupported: boolean;
  pushSupported: boolean;
}

export type RemoteTransport = "https" | "ssh" | "local" | "other";

export interface RemoteAuthenticationStatus {
  remote: string;
  transport: RemoteTransport;
  host: string | null;
  credentialAvailable: boolean;
  credentialHelperConfigured: boolean;
  suggestedSshUrl: string | null;
}

export interface FileChange {
  path: string;
  originalPath: string | null;
  indexStatus: ChangeKind;
  worktreeStatus: ChangeKind;
  conflicted: boolean;
  submodule: boolean;
}

export interface CommitSelectedResult {
  oid: string | null;
  snapshot: RepositorySnapshot | null;
  invalidatedSlices: RepositoryStateSlice[];
  refreshError: string | null;
  verificationWarning: string | null;
}

export interface CommitSummary {
  repositoryId: string;
  oid: string;
  shortOid: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: number;
  decorations: string[];
  subject: string;
}

export interface PushPreview {
  remote: string;
  branch: string;
  sourceRef: string;
  destinationRef: string;
  headOid: string;
  comparisonBaseOid: string | null;
  publish: boolean;
  ordinaryAllowed: boolean;
  ordinaryBlockReason: string | null;
  forceWithLeaseAllowed: boolean;
  forceWithLeaseBlockReason: string | null;
  tagMode: PushTagMode;
  tags: PushTagSummary[];
  files: CommitFileChange[];
  filesTruncated: boolean;
  commits: CommitSummary[];
  offset: number;
  totalCommits: number;
  hasMore: boolean;
  truncated: boolean;
  previewToken: string;
}

export type PushMode = "ordinary" | "forceWithLease";
export type PushTagMode = "none" | "all" | "currentBranch";

export interface PushTagSummary {
  name: string;
  fullRef: string;
  objectOid: string;
}

export type HistoryOrder = "topological" | "date";

export interface HistoryQuery {
  repositoryIds: string[];
  refs: HistoryRef[];
  startCommit: HistoryCommitStart | null;
  authorEmails: string[];
  currentAuthor: boolean;
  sinceEpoch: number | null;
  paths: HistoryPath[];
  firstParent: boolean;
  excludeMerges: boolean;
  order: HistoryOrder;
}

export interface HistoryCommitStart {
  repositoryId: string;
  oid: string;
}

export interface HistoryRef {
  repositoryId: string;
  fullName: string;
}

export interface HistoryPath {
  repositoryId: string;
  path: string;
}

export interface HistoryPage {
  commits: CommitSummary[];
  offset: number;
  hasMore: boolean;
}

export interface CommitDetails {
  repositoryId: string;
  oid: string;
  parentOid: string | null;
  files: CommitFileChange[];
}

export interface CommitComparisonDetails {
  repositoryId: string;
  beforeOid: string;
  afterOid: string;
  relation: CommitComparisonRelation;
  files: CommitFileChange[];
}

export type CommitComparisonRelation =
  | "beforeIsAncestor"
  | "afterIsAncestor"
  | "divergent";

export interface CommitFileChange {
  path: string;
  originalPath: string | null;
  status: ChangeKind;
}

export interface CommitFilePreview {
  repositoryId: string;
  commitOid: string;
  revisionOid: string;
  path: string;
  sourcePath: string;
  blobOid: string;
  fileMode: string;
  byteLength: number;
  kind: "text" | "image";
  content: string | null;
  utf8Bom: boolean | null;
  image: ImagePreview | null;
}

export interface CommitDiffResult {
  repositoryId: string;
  oid: string;
  path: string;
  patch: string;
  binary: boolean;
  truncated: boolean;
}

export interface CommitComparisonDiffResult {
  repositoryId: string;
  beforeOid: string;
  afterOid: string;
  path: string;
  patch: string;
  binary: boolean;
  truncated: boolean;
}

export interface GitBlameHunk {
  oid: string;
  originalStartLine: number;
  finalStartLine: number;
  lineCount: number;
  authorName: string;
  authorEmail: string;
  authoredAt: number;
  summary: string;
  uncommitted: boolean;
}

export interface GitBlameResult {
  repositoryId: string;
  path: string;
  revision: string | null;
  hunks: GitBlameHunk[];
  truncated: boolean;
}

export type BranchKind = "local" | "remote" | "tag";

export interface BranchSummary {
  repositoryId: string;
  fullName: string;
  name: string;
  oid: string;
  current: boolean;
  kind: BranchKind;
  upstream: string | null;
  tracking: string | null;
  committedAt: number;
  subject: string;
}

export type BranchMutationKind = "switch" | "create" | "checkoutRemote" | "rename" | "delete";

export interface BranchMutationRequest {
  kind: BranchMutationKind;
  sourceFullName: string;
  sourceOid: string;
  newName: string | null;
}

export interface BranchMutationPlan {
  repositoryRoot: string;
  kind: BranchMutationKind;
  sourceFullName: string;
  sourceOid: string;
  sourceKind: "local" | "remote" | "commit";
  sourceName: string;
  targetFullName: string | null;
  newName: string | null;
  startHeadRef: string;
  startHeadOid: string;
  upstream: string | null;
  mergedIntoCurrent: boolean | null;
  previewToken: string;
}

export interface RepositorySnapshot {
  root: string;
  gitDir: string;
  repositoryRoots: GitRootDescriptor[];
  branch: BranchState;
  operation: GitOperationSnapshot | null;
  changes: FileChange[];
  commits: CommitSummary[];
  branches: BranchSummary[];
  remotes: RemoteSummary[];
  untrackedState: "pending" | "complete" | "failed";
}

export type GitOperationKind =
  | "merge"
  | "cherryPick"
  | "rebase"
  | "squash"
  | "revert"
  | "bisect";

export type GitOperationPhase = "conflicted" | "paused";
export type GitOperationAction = "continue" | "skip" | "abort";

export interface GitConflictFile {
  path: string;
  baseOid: string | null;
  oursOid: string | null;
  theirsOid: string | null;
}

export interface GitOperationProgress {
  current: number | null;
  total: number | null;
  detail: string | null;
}

export interface GitOperationSnapshot {
  kind: GitOperationKind;
  phase: GitOperationPhase;
  originalHeadOid: string | null;
  currentHeadOid: string | null;
  headRef: string | null;
  targetOids: string[];
  conflicts: GitConflictFile[];
  progress: GitOperationProgress;
  allowedActions: GitOperationAction[];
}

export interface GitOperationPlan {
  kind: GitOperationKind;
  repositoryRoot: string;
  startHeadOid: string;
  startHeadRef: string;
  targetRefs: string[];
  targetOids: string[];
  commitCount: number;
  summary: string;
  message: string | null;
  previewToken: string;
}

export interface GitConflictContent {
  path: string;
  base: string | null;
  ours: string | null;
  theirs: string | null;
  worktree: string | null;
  binary: boolean;
  revisionToken: string;
}

export type RepositoryStateSlice =
  | "workspaceCatalog"
  | "openDocuments"
  | "repositoryCapability"
  | "workingTree"
  | "head"
  | "refs"
  | "history"
  | "operation";

export interface WorkspaceWatchStatus {
  available: boolean;
  message: string | null;
  watchInstance: number | null;
  verificationRequired: boolean;
}

export interface WorkspaceWatchInvalidation {
  root: string;
  generation: number;
  watchInstance: number;
  slices: RepositoryStateSlice[];
  paths: string[];
  causes: Array<"watcher" | "overflowRecovery">;
  recovery: WorkspaceWatchRecovery;
}

export interface RepositorySliceSnapshot {
  root: string;
  gitDir: string;
  repositoryRoots?: GitRootDescriptor[];
  branch?: BranchState;
  operation?: GitOperationSnapshot | null;
  changes?: FileChange[];
  commits?: CommitSummary[];
  branches?: BranchSummary[];
  remotes?: RemoteSummary[];
  untrackedState?: RepositorySnapshot["untrackedState"];
}

export interface RepositorySliceProject {
  root: string;
  repository: RepositorySliceSnapshot | null;
}

export type WorkspaceWatchRecovery =
  | "none"
  | "pathsTruncated"
  | "rootAmbiguous"
  | "backendOverflow";

export interface RepositoryMutationOutcome {
  snapshot: RepositorySnapshot;
  invalidatedSlices: RepositoryStateSlice[];
}

export interface WorkingTreeMutationOutcome {
  tracked: TrackedChangeScan;
  invalidatedSlices: RepositoryStateSlice[];
}

export interface RestoreChangesPlan {
  root: string;
  selected: FileChange[];
  paths: string[];
  headOid: string;
  token: string;
}

export interface GitWorktreeRecovery {
  id: string;
  operation: string;
  paths: string[];
  status: string;
  canUndo: boolean;
  backupPath: string;
}

export interface GitOperationMutationOutcome {
  tracked: TrackedChangeScan;
  operation: GitOperationSnapshot | null;
  invalidatedSlices: RepositoryStateSlice[];
}

export interface OpenedProject {
  root: string;
  repository: RepositorySnapshot | null;
}

export type ProjectWindowMatch = "notOpen" | "current" | "focusedExisting";

export interface ProjectWindowOpenResult {
  windowLabel: string;
  focusedExisting: boolean;
}

export interface TerminalStarted {
  protocolVersion: 1;
  sessionId: string;
  shell: string;
  cwd: string;
}

export type TerminalEvent =
  | {
      protocolVersion: 1;
      kind: "output";
      sessionId: string;
      sequence: number;
      dataBase64: string;
    }
  | {
      protocolVersion: 1;
      kind: "exited";
      sessionId: string;
      exitCode: number;
      signal: string | null;
    }
  | {
      protocolVersion: 1;
      kind: "error";
      sessionId: string;
      message: string;
    };

export interface ImagePreview {
  path: string;
  mediaType: string;
  dataUrl: string;
  width: number;
  height: number;
  byteLength: number;
}

export interface ImageDiffPreview {
  path: string;
  before: ImagePreview | null;
  after: ImagePreview | null;
}

export interface UntrackedScan {
  root: string;
  changes: FileChange[];
}

export interface ProjectFileList {
  root: string;
  paths: string[];
  files: ProjectFile[];
  ignoredEntries: ProjectIgnoredEntry[];
  repositoryRoots: GitRootDescriptor[];
  truncated: boolean;
}

export interface ProjectFile {
  repositoryId: string;
  path: string;
  workspacePath: string;
  readOnly?: boolean;
}

export interface ProjectIgnoredEntry {
  workspacePath: string;
  kind: "file" | "directory";
}

export interface TextFileSnapshot {
  workspacePath: string;
  content: string;
  utf8Bom: boolean;
  revision: string;
  byteLength: number;
}

export interface SaveTextFileResult {
  workspacePath: string;
  revision: string;
  byteLength: number;
  requestId: string;
  alreadySaved: boolean;
}

export interface TrackedChangeScan {
  root: string;
  changes: FileChange[];
}

export type SearchCoverageReason =
  | "catalogTruncated"
  | "candidateLimit"
  | "byteLimit"
  | "matchLimit"
  | "skippedFiles";

export type SearchSkipReason =
  | "tooLarge"
  | "invalidUtf8"
  | "binaryNul"
  | "notFound"
  | "permissionDenied"
  | "unsafePath"
  | "unsupportedType"
  | "changedDuringRead"
  | "io";

export type WorkspaceTextSearchMode = "literal" | "regex";

export interface WorkspaceTextSearchOptions {
  mode: WorkspaceTextSearchMode;
  includeGlobs: string[];
  excludeGlobs: string[];
  contextLines: number;
}

export interface WorkspaceTextSearchMatch {
  repositoryId: string;
  path: string;
  workspacePath: string;
  revision: string;
  fromUtf16: number;
  toUtf16: number;
  line: number;
  columnUtf16: number;
  preview: string;
  previewFromUtf16: number;
  previewToUtf16: number;
  leadingClipped: boolean;
  trailingClipped: boolean;
}

export interface WorkspaceTextSearchSkippedFile {
  repositoryId: string;
  path: string;
  workspacePath: string;
  reason: SearchSkipReason;
}

export interface WorkspaceTextSearchReport {
  requestId: string;
  matches: WorkspaceTextSearchMatch[];
  catalogCandidates: number;
  eligibleCandidates: number;
  filesSearched: number;
  bytesRead: number;
  skippedCount: number;
  skippedFiles: WorkspaceTextSearchSkippedFile[];
  coverageReasons: SearchCoverageReason[];
}

export interface WorkspaceReplacementFilePreview {
  repositoryId: string;
  path: string;
  workspacePath: string;
  matchCount: number;
  byteDelta: number;
  beforePreview: string;
  afterPreview: string;
}

export interface WorkspaceReplacementPreview {
  planId: string;
  files: WorkspaceReplacementFilePreview[];
  totalMatches: number;
  skippedCount: number;
  coverageReasons: SearchCoverageReason[];
}

export type WorkspaceEntryKind = "file" | "directory";
export type WorkspaceCollisionPolicy = "cancel" | "renameTarget";

export interface WorkspaceEntryIdentity {
  workspacePath: string;
  kind: WorkspaceEntryKind;
  revision: string;
  mode: number;
  byteLength: number;
}

export interface WorkspaceEntryInspection {
  source: WorkspaceEntryIdentity;
  entryCount: number;
  totalBytes: number;
  hiddenEntryCount: number;
  symlinkPaths: string[];
  nestedRepositoryPaths: string[];
  multipleLinkPaths: string[];
  truncated: boolean;
  fingerprint: string;
}

export interface WorkspaceRevealResult {
  selected: boolean;
}

export type WorkspaceMutationOperation =
  | { kind: "createFile"; destination: string }
  | { kind: "copy"; source: string; destination: string }
  | { kind: "move"; source: string; destination: string }
  | { kind: "trash"; source: string };

export type WorkspaceMutationBlocker =
  | { kind: "destinationExists"; path: string }
  | { kind: "destinationInsideSource"; path: string }
  | { kind: "symlink"; paths: string[] }
  | { kind: "nestedRepository"; paths: string[] }
  | { kind: "multipleHardLinks"; paths: string[] }
  | { kind: "inventoryTruncated" };

export interface WorkspaceMutationPreview {
  planId: string;
  operation: WorkspaceMutationOperation;
  collisionPolicy: WorkspaceCollisionPolicy;
  source: WorkspaceEntryIdentity | null;
  entryCount: number;
  totalBytes: number;
  hiddenEntryCount: number;
  fingerprint: string | null;
  blockers: WorkspaceMutationBlocker[];
}

export type WorkspaceMutationStatus =
  | "completed"
  | "noOp"
  | "cancelledBeforeWrite"
  | "failedWithoutChange"
  | "failedWithRecovery"
  | "uncertain";

export type WorkspaceMutationInvalidation =
  | "workspaceCatalog"
  | "openDocuments"
  | "workingTree";

export interface WorkspacePathRemap {
  source: string;
  destination: string;
}

export interface WorkspaceMutationOutcome {
  planId: string;
  status: WorkspaceMutationStatus;
  affectedPaths: string[];
  pathRemaps: WorkspacePathRemap[];
  invalidatedSlices: WorkspaceMutationInvalidation[];
  recoveryId: string | null;
  error: string | null;
}

export interface WorkspaceMutationRecoverySummary {
  recoveryId: string;
  workspaceRoot: string;
  operation: WorkspaceMutationOperation;
  phase: string;
  destination: string | null;
  sourceHold: string | null;
}

export type ReplacementRecoveryStatus = "applied" | "rolledBack" | "needsRecovery";
export type ReplacementFileState = "original" | "replaced" | "conflict" | "unavailable";

export interface ReplacementRecoveryFile {
  workspacePath: string;
  state: ReplacementFileState;
}

export interface ReplacementRecoverySummary {
  recoveryId: string;
  status: ReplacementRecoveryStatus;
  files: ReplacementRecoveryFile[];
}

export interface ReplacementApplyResult extends ReplacementRecoverySummary {
  message: string | null;
}

export type GitRootKind = "main" | "submodule";

export interface GitRootDescriptor {
  id: string;
  relativePath: string;
  displayName: string;
  kind: GitRootKind;
}

export interface DiffResult {
  path: string;
  staged: boolean;
  patch: string;
  binary: boolean;
  truncated: boolean;
}

export type WorkspaceView = "changes" | "history" | "branches";

export interface ChangeSelection {
  path: string;
  staged: boolean;
}
