import { editorDocumentKey } from "../editor-document.ts";
import type { ProjectFile, WorkspaceTextSearchMatch } from "../models.ts";
import type { EditorCopy } from "../localization/catalog.ts";
import { EditorNavigationHistory, type EditorNavigationGateway } from "../features/files-editor/editor-navigation-history.ts";
import type { EditorSessionController } from "../features/files-editor/editor-session-controller.ts";
import { activeTextTab, textTab, type TextTabState } from "../features/files-editor/editor-session.ts";
import type { EditorSurface } from "../features/files-editor/editor-surface.ts";
import { evaluateSearchNavigation } from "../features/files-editor/search-navigation.ts";

export function applyEditorSearchNavigation(tab: TextTabState, match: WorkspaceTextSearchMatch, options: {
  root: string | null;
  copy: EditorCopy;
  prepare(): void;
  select(from: number, to: number): boolean;
  warn(message: string): void;
}): void {
  const decision = evaluateSearchNavigation(options.root, tab, match);
  if (decision !== "ready") {
    const message = decision === "wrongWorkspace" ? options.copy.wrongWorkspace
      : decision === "dirty" ? options.copy.searchUnsaved
        : decision === "invalidRange" ? options.copy.invalidSearchLocation : options.copy.staleSearchResult;
    options.warn(message); return;
  }
  options.prepare();
  queueMicrotask(() => {
    if (!options.select(match.fromUtf16, match.toUtf16)) options.warn(options.copy.invalidSearchLocation);
  });
}

export function createEditorNavigationRuntime(options: {
  surface: EditorSurface;
  root(): string | null;
  loading(): boolean;
  files(): readonly ProjectFile[];
  editor(): EditorSessionController;
  open(root: string, file: ProjectFile): Promise<void>;
  diagnostic: EditorNavigationGateway["diagnostic"];
}): EditorNavigationHistory {
  const history = new EditorNavigationHistory({
    open: async document => {
      if (options.loading() || options.root() !== document.repositoryRoot) return "blocked";
      const file = options.files().find(file => file.workspacePath === document.workspacePath
        && file.repositoryId === document.repositoryId && file.path === document.path);
      if (!file) return "missing";
      await options.open(document.repositoryRoot, file);
      return options.root() === document.repositoryRoot
        && editorDocumentKey(options.editor().activeDocument()) === editorDocumentKey(document)
        && options.editor().tab(editorDocumentKey(document))?.status === "ready" ? "opened" : "blocked";
    },
    select: (anchor, head) => {
      const tab = activeTextTab(options.editor().state.session);
      if (tab?.markdownMode === "preview") options.editor().setMarkdownMode(tab.id, "source");
      return options.surface.restoreNavigationSelection(anchor, head);
    },
    diagnostic: options.diagnostic,
  });
  options.surface.setNavigationObserver(update => {
    const tab = textTab(options.editor().state.session, update.tabId);
    if (tab?.status !== "ready" || tab.document.repositoryRoot !== options.root()) return;
    history.installWorkspace(tab.document.repositoryRoot); history.observe(tab.document, update);
  });
  return history;
}
