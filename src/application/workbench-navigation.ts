import type { HistoryQuery } from "../models.ts";

export interface WorkspaceTargetIdentity {
  readonly workspaceRoot: string;
  readonly workspaceGeneration: number;
}

export interface WorkspaceEntryIdentity extends WorkspaceTargetIdentity {
  readonly workspacePath: string;
  readonly kind: "file" | "directory";
}

export interface WorkspaceDocumentIdentity extends WorkspaceEntryIdentity {
  readonly kind: "file";
  readonly repositoryId: string;
  readonly path: string;
}

export interface WorkingDiffIdentity extends WorkspaceTargetIdentity {
  readonly path: string;
}

export interface CommitIdentity extends WorkspaceTargetIdentity {
  readonly repositoryId: string;
  readonly oid: string;
}

export interface CommitFileIdentity extends CommitIdentity {
  readonly path: string;
}

export interface CommitRangeIdentity extends WorkspaceTargetIdentity {
  readonly repositoryId: string;
  readonly beforeOid: string;
  readonly afterOid: string;
}

export interface HistoryQueryIntent extends WorkspaceTargetIdentity {
  readonly query: HistoryQuery;
}

export type ReviewedGitOperationIntent =
  | { readonly kind: "merge" | "rebase"; readonly targetRef: string }
  | { readonly kind: "cherryPick" | "revert"; readonly commitOids: readonly string[] };

/** Cross-feature navigation only. Implementations revalidate every captured identity. */
export interface WorkbenchNavigationPort {
  openWorkspaceDocument(target: WorkspaceDocumentIdentity): void;
  revealWorkspaceEntry(target: WorkspaceEntryIdentity): void;
  openWorkingDiff(target: WorkingDiffIdentity): void;
  openCommitDiff(target: CommitFileIdentity): void;
  openRangeDiff(target: CommitRangeIdentity): void;
  installHistoryQuery(intent: HistoryQueryIntent): void;
  openReviewedGitOperation(target: CommitIdentity, intent: ReviewedGitOperationIntent): void;
  openUpdateReview(target: WorkspaceTargetIdentity): void;
  openPushReview(target: WorkspaceTargetIdentity): void;
}
