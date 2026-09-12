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
  commits: CommitSummary[];
  offset: number;
  totalCommits: number;
  hasMore: boolean;
  truncated: boolean;
  previewToken: string;
}

export type HistoryOrder = "topological" | "date";

export interface HistoryQuery {
  repositoryIds: string[];
  refs: HistoryRef[];
  authorEmails: string[];
  currentAuthor: boolean;
  sinceEpoch: number | null;
  paths: HistoryPath[];
  firstParent: boolean;
  excludeMerges: boolean;
  order: HistoryOrder;
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

export interface CommitFileChange {
  path: string;
  originalPath: string | null;
  status: ChangeKind;
}

export interface CommitDiffResult {
  repositoryId: string;
  oid: string;
  path: string;
  patch: string;
  binary: boolean;
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

export interface RepositorySnapshot {
  root: string;
  gitDir: string;
  repositoryRoots: GitRootDescriptor[];
  branch: BranchState;
  operation: string | null;
  changes: FileChange[];
  commits: CommitSummary[];
  branches: BranchSummary[];
  remotes: RemoteSummary[];
  untrackedState: "pending" | "complete" | "failed";
}

export interface OpenedProject {
  root: string;
  repository: RepositorySnapshot | null;
}

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
