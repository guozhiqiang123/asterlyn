export interface EditorPathMapping {
  sourceWorkspacePath: string;
  destinationWorkspacePath: string;
  sourceRepositoryId: string;
  destinationRepositoryId: string;
  sourcePath: string;
  destinationPath: string;
}

export type EditorPathMutationRequest =
  | { kind: "move"; mapping: EditorPathMapping }
  | { kind: "trash"; sourceWorkspacePath: string }
  | { kind: "trashMany"; sourceWorkspacePaths: readonly string[] };

export type EditorPathMutationBlocker =
  | "invalidMapping"
  | "mutationInProgress"
  | "saveInFlight"
  | "sourceLoading"
  | "destinationOpen"
  | "dirtyDelete";

export interface EditorPathMutationLeaseTab {
  id: string;
  loadEpoch: number;
  revision: string | null;
  persistedContent: string;
}

export interface EditorPathMutationLease {
  request: EditorPathMutationRequest;
  tabs: EditorPathMutationLeaseTab[];
}

export interface EditorRuntimeTabRemap {
  sourceId: string;
  destinationId: string;
  destinationPath: string;
}
