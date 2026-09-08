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

export interface CommitSummary {
  oid: string;
  shortOid: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: number;
  decorations: string[];
  subject: string;
}

export interface CommitDetails {
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
  oid: string;
  path: string;
  patch: string;
  binary: boolean;
  truncated: boolean;
}

export type BranchKind = "local" | "remote" | "tag";

export interface BranchSummary {
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
  branch: BranchState;
  operation: string | null;
  changes: FileChange[];
  commits: CommitSummary[];
  branches: BranchSummary[];
  remotes: RemoteSummary[];
  untrackedState: "pending" | "complete" | "failed";
}

export interface UntrackedScan {
  root: string;
  changes: FileChange[];
}

export interface ProjectFileList {
  root: string;
  paths: string[];
  truncated: boolean;
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
