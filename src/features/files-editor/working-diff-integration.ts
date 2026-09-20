import { editorDocumentContentKey, editorDocumentKey, type EditorDocument } from "../../editor-document.ts";
import type { DiffResult, ProjectFile, WorkingDiffBase } from "../../models.ts";
import type { AppPreferences } from "../../preferences.ts";
import type { DiffPresentation } from "../../diff-presentation.ts";
import type { EditorSurface } from "./editor-surface.ts";
import { activeTextTab, textTab, type EditorSession, type TextTabState } from "./editor-session.ts";

type DiffDocument = Extract<EditorDocument, {
  kind: "working-diff" | "commit-diff" | "commit-comparison-diff";
}>;
type WorkingDiffDocument = Extract<EditorDocument, { kind: "working-diff" }>;

interface EditableWorkingDiffState {
  readonly workingPatch: DiffResult | null;
  readonly workingDiffBase: WorkingDiffBase | null;
  readonly workingPatchVersion: number;
}

export function diffProjectFile(files: readonly ProjectFile[], document: DiffDocument): ProjectFile | null {
  return document.kind === "working-diff"
    ? files.find((file) => file.repositoryId === "." && file.path === document.selection.path) ?? null
    : files.find((file) => file.repositoryId === document.repositoryId && file.path === document.path) ?? null;
}

export function workingDiffTextTab(
  session: EditorSession,
  document: WorkingDiffDocument,
  files: readonly ProjectFile[],
): TextTabState | null {
  const file = diffProjectFile(files, document);
  return file ? textTab(session, editorDocumentKey({
    kind: "project-file",
    repositoryRoot: document.repositoryRoot,
    repositoryId: file.repositoryId,
    path: file.path,
    workspacePath: file.workspacePath,
    readOnly: file.readOnly === true,
  })) : null;
}

export function activeEditableTextTab(
  session: EditorSession,
  document: EditorDocument,
  files: readonly ProjectFile[],
): TextTabState | null {
  return activeTextTab(session) ??
    (document.kind === "working-diff" ? workingDiffTextTab(session, document, files) : null);
}

export function workingDiffExpanded(document: DiffDocument, expandedKey: string | null): boolean {
  return expandedKey === editorDocumentKey(document);
}

export function workingDiffActive(document: EditorDocument, repositoryRoot: string | null): boolean {
  return document.kind === "working-diff" && document.repositoryRoot === repositoryRoot;
}

export function activeProjectWorkspacePath(
  workspaceRoot: string,
  document: EditorDocument,
  files: readonly ProjectFile[],
): string | null {
  if (document.kind === "welcome" || document.repositoryRoot !== workspaceRoot) return null;
  if (document.kind === "project-file" || document.kind === "project-image") return document.workspacePath;
  if (document.kind === "working-diff") return document.selection.path;
  if (document.kind === "conflict-resolution") return document.path;
  return files.find((file) => file.repositoryId === document.repositoryId && file.path === document.path)?.workspacePath ?? null;
}

export function showsContextHeader(document: EditorDocument): boolean {
  return document.kind === "working-diff" || document.kind === "commit-diff" ||
    document.kind === "commit-comparison-diff" || document.kind === "conflict-resolution" ||
    document.kind === "historical-file" || document.kind === "historical-file-comparison";
}

export function mountEditableWorkingDiff(options: {
  surface: EditorSurface;
  document: WorkingDiffDocument;
  state: EditableWorkingDiffState;
  tab: TextTabState | null;
  preferences: AppPreferences;
  presentation: DiffPresentation;
  beforeTransition: () => void;
  onContentChange: (tabId: string, content: string) => void;
}): boolean {
  const { surface, document, state, tab } = options;
  if (!state.workingPatch || !state.workingDiffBase || tab?.status !== "ready" || state.workingPatch.binary) {
    return false;
  }
  surface.mountEditableDiff(
    editorDocumentContentKey(document, `editable:${state.workingPatchVersion}:${tab.loadEpoch}`),
    state.workingDiffBase.content,
    tab,
    options.preferences,
    options.presentation,
    options.beforeTransition,
    options.onContentChange,
  );
  return true;
}
