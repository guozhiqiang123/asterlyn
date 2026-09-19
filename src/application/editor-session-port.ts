import type {
  EditorPathMutationBlocker,
  EditorPathMutationLease,
  EditorRuntimeTabRemap,
} from "../workbench/editor-session.ts";

export interface EditorPathMigrationLease {
  id: number;
  workspaceRoot: string;
  workspaceGeneration: number;
  editor: EditorPathMutationLease;
}

export type EditorPathMigrationPreparation =
  | { status: "ready"; lease: EditorPathMigrationLease }
  | { status: "blocked"; reason: EditorPathMutationBlocker }
  | { status: "stale" };

export interface EditorPathRuntimeChange {
  remaps: readonly EditorRuntimeTabRemap[];
  disposedTabIds: readonly string[];
}
