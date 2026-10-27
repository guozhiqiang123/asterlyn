import { editorDocumentContentKey, editorDocumentKey, type EditorDocument } from "../../editor-document.ts";
import type { DiffResult, FileChange, ProjectFile, WorkingDiffBase } from "../../models.ts";
import type { AppPreferences } from "../../preferences.ts";
import type { DiffPresentation, DiffSideLabels } from "../../diff-presentation.ts";
import { splitUnifiedDiff } from "../../diff-presentation.ts";
import type { DiffGitBlameSources } from "./editor-gutter.ts";
import type { EditorSurface } from "./editor-surface.ts";
import { activeTextTab, isTextTabDirty, textTab, type EditorSession, type TextTabState } from "./editor-session.ts";
import { decodeExactText } from "./text-content.ts";

type DiffDocument = Extract<EditorDocument, {
  kind: "working-diff" | "commit-diff" | "commit-comparison-diff";
}>;
type WorkingDiffDocument = Extract<EditorDocument, { kind: "working-diff" }>;

interface EditableWorkingDiffState {
  readonly workingPatch: DiffResult | null;
  readonly workingDiffBase: WorkingDiffBase | null;
  readonly workingPatchVersion: number;
}

export function editableWorkingDiffBlameSources(
  sources: DiffGitBlameSources,
  tab: TextTabState | null,
  unsavedReason: string,
): DiffGitBlameSources {
  return tab && (isTextTabDirty(tab) || tab.saveRequest !== null)
    ? { ...sources, new: { source: null, unavailableReason: unsavedReason } }
    : sources;
}

export function diffProjectFile(files: readonly ProjectFile[], document: DiffDocument): ProjectFile | null {
  if (document.kind === "working-diff") {
    const repositoryId = document.selection.repositoryId || ".";
    return files.find((file) =>
      file.repositoryId === repositoryId &&
      file.path === document.selection.path
    ) ?? {
      repositoryId,
      path: document.selection.path,
      workspacePath: document.selection.path,
      readOnly: false,
    };
  }
  return files.find((file) => file.repositoryId === document.repositoryId && file.path === document.path) ?? null;
}

export function workingDiffSourceFile(
  files: readonly ProjectFile[],
  document: DiffDocument,
  changes: readonly FileChange[],
): ProjectFile | null {
  if (document.kind === "working-diff") {
    const repositoryId = document.selection.repositoryId || ".";
    const change = changes.find((candidate) =>
      (candidate.repositoryId || ".") === repositoryId &&
      candidate.path === document.selection.path
    );
    const deleted = change?.worktreeStatus === "deleted" || (
      change?.indexStatus === "deleted" && change.worktreeStatus === "unmodified"
    );
    if (!change || deleted) return null;
  }
  return diffProjectFile(files, document);
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
  if (document.kind === "welcome" || document.kind === "language-source" || document.repositoryRoot !== workspaceRoot) return null;
  if (document.kind === "project-file" || document.kind === "project-image") return document.workspacePath;
  if (document.kind === "working-diff") {
    return diffProjectFile(files, document)?.workspacePath ?? document.selection.path;
  }
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
  sideLabels: DiffSideLabels;
  blameSources: DiffGitBlameSources;
  expandedUnchanged: boolean;
  beforeTransition: () => void;
  onContentChange: (tabId: string, content: string) => void;
  onRevert?: (tabId: string) => void;
}): boolean {
  const { surface, document, state, tab } = options;
  if (!state.workingPatch || !state.workingDiffBase || tab?.status !== "ready" || state.workingPatch.binary) {
    return false;
  }
  if (!workingDiffBackingContentMatchesPatch(
    state.workingPatch,
    state.workingDiffBase,
    tab,
  )) return false;
  surface.mountEditableDiff(
    editorDocumentContentKey(
      document,
      `editable:${state.workingPatchVersion}:${tab.loadEpoch}:${options.expandedUnchanged ? "expanded" : "collapsed"}`,
    ),
    state.workingDiffBase.content,
    tab,
    options.preferences,
    options.presentation,
    options.sideLabels,
    options.blameSources,
    options.expandedUnchanged,
    options.beforeTransition,
    options.onContentChange,
    options.onRevert,
  );
  return true;
}

/**
 * Guards the editable Changes Diff against a stale clean backing tab.
 *
 * The Git patch is authoritative for what is currently on disk, while `tab.content` may include
 * valid unsaved edits. Compare the patch against `persistedContent`, not the live buffer: this
 * preserves unsaved work while refusing to replace a correct Git patch with an obsolete cached
 * document. The caller falls back to the read-only Git patch when this returns false.
 */
export function workingDiffBackingContentMatchesPatch(
  patch: DiffResult,
  base: WorkingDiffBase,
  tab: Pick<TextTabState, "persistedContent">,
): boolean {
  if (patch.binary || patch.patch.length === 0 || patch.headOid !== base.headOid) return false;
  const beforeText = decodeExactText(base.content).text;
  const afterText = decodeExactText(tab.persistedContent).text;
  // A non-empty Git patch cannot describe two identical text sources. This explicit invariant
  // closes the pure-addition race where every added row exists after HEAD advances, so line-only
  // validation would otherwise mount an all-unchanged editable Diff.
  if (beforeText === afterText) return false;
  const rows = splitUnifiedDiff(patch.patch).rows;
  const changed = rows.filter((row) =>
    row.kind === "added" || row.kind === "removed" || row.kind === "modified"
  );
  // An unfamiliar or metadata-only patch cannot prove that the editable sources describe the
  // same Git read. Fail closed to the authoritative read-only patch instead.
  if (changed.length === 0) return false;
  const beforeLines = beforeText.split("\n");
  const afterLines = afterText.split("\n");
  return rows.every((row) => {
    if (row.kind === "omitted" || row.kind === "notice") return true;
    return sideMatches(beforeLines, row.old.lineNumber, row.old.text) &&
      sideMatches(afterLines, row.new.lineNumber, row.new.text);
  });
}

function sideMatches(
  document: readonly string[],
  lineNumber: number | null,
  expected: string,
): boolean {
  return lineNumber === null || document[lineNumber - 1] === expected;
}
