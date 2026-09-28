export interface StashEntry {
  repositoryId: string;
  reference: string;
  oid: string;
  parentOid: string;
  authoredAt: number;
  subject: string;
}

export interface StashCatalog {
  entries: StashEntry[];
  truncatedRepositoryIds: string[];
}

export type StashMutationKind = "apply" | "pop" | "drop" | "clear" | "branch";

export interface StashMutationRequest {
  kind: StashMutationKind;
  repositoryId: string;
  reference: string | null;
  oid: string | null;
  reinstateIndex: boolean;
  branchName: string | null;
  expectedOids: string[];
}
