import type { ChangeSelection } from "../models";

export type EditorDocument =
  | { kind: "welcome" }
  | { kind: "project-file"; repositoryRoot: string; path: string }
  | {
      kind: "working-diff";
      repositoryRoot: string;
      selection: ChangeSelection;
    }
  | {
      kind: "commit-diff";
      repositoryRoot: string;
      oid: string;
      path: string;
    };

export function editorDocumentKey(document: EditorDocument): string {
  switch (document.kind) {
    case "welcome":
      return "welcome";
    case "project-file":
      return `file\0${document.repositoryRoot}\0${document.path}`;
    case "working-diff":
      return `working\0${document.repositoryRoot}\0${document.selection.staged ? "index" : "worktree"}\0${document.selection.path}`;
    case "commit-diff":
      return `commit\0${document.repositoryRoot}\0${document.oid}\0${document.path}`;
  }
}

export function editorDocumentContentKey(
  document: EditorDocument,
  contentRevision: string,
): string {
  return `${editorDocumentKey(document)}\0${contentRevision}`;
}
