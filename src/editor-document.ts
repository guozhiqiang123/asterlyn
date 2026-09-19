import type { ChangeKind, ChangeSelection } from "./models";

export interface ProjectFileDocument {
  kind: "project-file";
  repositoryRoot: string;
  repositoryId: string;
  path: string;
  workspacePath: string;
  readOnly?: boolean;
}

export interface ProjectImageDocument {
  kind: "project-image";
  repositoryRoot: string;
  repositoryId: string;
  path: string;
  workspacePath: string;
}

export interface HistoricalFileDocument {
  kind: "historical-file";
  repositoryRoot: string;
  repositoryId: string;
  commitOid: string;
  path: string;
  originalPath: string | null;
  status: ChangeKind;
}

export interface HistoricalFileComparisonDocument {
  kind: "historical-file-comparison";
  repositoryRoot: string;
  repositoryId: string;
  commitOid: string;
  path: string;
  originalPath: string | null;
  status: ChangeKind;
  currentSource: "disk" | "buffer";
}

export type EditorDocument =
  | { kind: "welcome" }
  | ProjectFileDocument
  | ProjectImageDocument
  | HistoricalFileDocument
  | HistoricalFileComparisonDocument
  | {
      kind: "working-diff";
      repositoryRoot: string;
      selection: ChangeSelection;
    }
  | {
      kind: "commit-diff";
      repositoryRoot: string;
      repositoryId: string;
      oid: string;
      path: string;
    }
  | {
      kind: "commit-comparison-diff";
      repositoryRoot: string;
      repositoryId: string;
      beforeOid: string;
      afterOid: string;
      path: string;
    };

export function editorDocumentKey(document: EditorDocument): string {
  switch (document.kind) {
    case "welcome":
      return "welcome";
    case "project-file":
      return `file\0${document.repositoryRoot}\0${document.repositoryId}\0${document.path}`;
    case "project-image":
      return `image\0${document.repositoryRoot}\0${document.repositoryId}\0${document.path}`;
    case "historical-file":
      return `historical\0${document.repositoryRoot}\0${document.repositoryId}\0${document.commitOid}\0${document.path}\0${document.originalPath ?? ""}\0${document.status}`;
    case "historical-file-comparison":
      return `historical-comparison\0${document.repositoryRoot}\0${document.repositoryId}\0${document.commitOid}\0${document.path}\0${document.originalPath ?? ""}\0${document.status}\0${document.currentSource}`;
    case "working-diff":
      return `working\0${document.repositoryRoot}\0${document.selection.staged ? "index" : "worktree"}\0${document.selection.path}`;
    case "commit-diff":
      return `commit\0${document.repositoryRoot}\0${document.repositoryId}\0${document.oid}\0${document.path}`;
    case "commit-comparison-diff":
      return `comparison\0${document.repositoryRoot}\0${document.repositoryId}\0${document.beforeOid}\0${document.afterOid}\0${document.path}`;
  }
}

export function editorDocumentContentKey(
  document: EditorDocument,
  contentRevision: string,
): string {
  return `${editorDocumentKey(document)}\0${contentRevision}`;
}
