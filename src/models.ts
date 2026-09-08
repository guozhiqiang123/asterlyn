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
  ahead: number;
  behind: number;
  detached: boolean;
  unborn: boolean;
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

