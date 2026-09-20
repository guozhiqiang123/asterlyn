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
