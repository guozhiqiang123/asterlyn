export type RemoteMutationKind = "add" | "edit" | "delete";

export interface RemoteMutationRequest {
  kind: RemoteMutationKind;
  sourceName: string | null;
  name: string;
  url: string | null;
}

export interface RemoteMutationPlan {
  repositoryRoot: string;
  kind: RemoteMutationKind;
  sourceName: string | null;
  targetName: string;
  sourceUrl: string | null;
  targetUrl: string | null;
  configurationToken: string;
  previewToken: string;
}

export type GitResetMode = "soft" | "mixed" | "hard" | "keep";

export interface GitResetPlan {
  repositoryRoot: string;
  startHeadRef: string;
  startHeadOid: string;
  targetOid: string;
  previewToken: string;
}

export type TagMutationKind = "create" | "checkout" | "push" | "deleteLocal" | "deleteRemote";

export interface TagMutationRequest {
  kind: TagMutationKind;
  tagName: string;
  commitOid: string;
  remote: string | null;
}

export type BranchMutationKind = "switch" | "create" | "checkoutRemote" | "rename" | "delete" | "removeWorktree";

export interface BranchMutationRequest {
  kind: BranchMutationKind;
  sourceFullName: string;
  sourceOid: string;
  newName: string | null;
  deleteRemote: boolean;
  forceWorktreeRemoval: boolean;
  reviewedWorktreeToken: string | null;
}

export interface RemoteBranchDeletionTarget {
  remote: string;
  branchFullName: string;
  trackingFullName: string;
  oid: string;
}

export interface WorktreeRemovalReview {
  path: string;
  changedPaths: string[];
  totalChangedPaths: number;
  changesTruncated: boolean;
  primaryHeadRef: string | null;
  primaryHeadOid: string;
  unmergedCommitCount: number;
  forceRequired: boolean;
  forceAuthorized: boolean;
  reviewToken: string;
}

export interface WorktreeCreationRequest {
  sourceFullName: string;
  sourceOid: string;
  parentDirectory: string;
  projectName: string;
  newBranch: string | null;
}

export interface WorktreeCreationPlan {
  repositoryRoot: string;
  sourceFullName: string;
  sourceName: string;
  sourceOid: string;
  parentDirectory: string;
  projectName: string;
  destinationPath: string;
  newBranch: string | null;
  startHeadRef: string;
  startHeadOid: string;
  previewToken: string;
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
  worktreeReview: WorktreeRemovalReview | null;
  deleteRemote: boolean;
  remoteDeletion: RemoteBranchDeletionTarget | null;
  previewToken: string;
}
