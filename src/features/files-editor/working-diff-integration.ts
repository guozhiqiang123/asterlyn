import { editorDocumentContentKey, editorDocumentKey, type EditorDocument } from "../../editor-document.ts";
import type { ChangesCommitState } from "../changes-commit/changes-commit-controller.ts";
import type { ProjectFile } from "../../models.ts";
import type { AppPreferences } from "../../preferences.ts";
import type { DiffPresentation } from "../../diff-presentation.ts";
import type { EditorSurface } from "./editor-surface.ts";
import { activeTextTab, textTab, type EditorSession, type TextTabState } from "./editor-session.ts";

type DiffDocument = Extract<EditorDocument, {
  kind: "working-diff" | "commit-diff" | "commit-comparison-diff";
}>;
type WorkingDiffDocument = Extract<EditorDocument, { kind: "working-diff" }>;

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

export function mountEditableWorkingDiff(options: {
  surface: EditorSurface;
  document: WorkingDiffDocument;
  state: ChangesCommitState;
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
