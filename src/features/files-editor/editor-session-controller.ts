import type {
  ImagePreview,
  ProjectFile,
  SaveTextFileResult,
  TextFileSnapshot,
} from "../../models.ts";
import {
  editorDocumentKey,
  type EditorDocument,
  type ProjectFileDocument,
  type ProjectImageDocument,
} from "../../workbench/editor-document.ts";
import {
  activatePreview,
  activateTextTab,
  activateWelcome,
  activeEditorDocument,
  beginTextReload,
  beginTextSave,
  captureTextContent,
  closePreview,
  closeTextTab,
  completeTextLoad,
  completeTextSave,
  createEditorSession,
  dirtyTextTabs,
  failTextLoad,
  failTextSave,
  isTextTabDirty,
  markTextExternalConflict,
  markTextEdited,
  openTextDocument,
  reconcileExternalTextSnapshot,
  setTextTabMarkdownMode,
  textTab,
  type EditorSession,
  type MarkdownEditorMode,
  type TextTabState,
} from "../../workbench/editor-session.ts";

type PreviewDocument = Exclude<EditorDocument, { kind: "welcome" | "project-file" }>;

export interface EditorSessionState {
  workspaceRoot: string | null;
  session: EditorSession;
}

export type EditorSessionChangeReason =
  | "workspace"
  | "activation"
  | "edit"
  | "markdown-mode"
  | "load-start"
  | "load-complete"
  | "load-error"
  | "save-start"
  | "save-complete"
  | "save-error"
  | "external-change"
  | "close";

export interface EditorSessionChange {
  reason: EditorSessionChangeReason;
  tabId?: string;
  documentChanged?: boolean;
  tabsChanged?: boolean;
  contentChanged?: boolean;
  error?: string;
}

export interface EditorSessionGateway {
  readTextFile(
    repositoryRoot: string,
    repositoryId: string,
    path: string,
  ): Promise<TextFileSnapshot>;
  saveTextFile(
    repositoryRoot: string,
    repositoryId: string,
    path: string,
    expectedRevision: string,
    content: string,
    utf8Bom: boolean,
    requestId: string,
  ): Promise<SaveTextFileResult>;
  readImageFile(
    repositoryRoot: string,
    repositoryId: string,
    path: string,
  ): Promise<ImagePreview>;
}

export type OpenTextResult =
  | { status: "ready" | "existing"; tab: TextTabState }
  | { status: "limit" }
  | { status: "stale" }
  | { status: "failure"; error: unknown; tabId: string };

export type SaveTextResult =
  | { status: "saved" | "newer-edits"; tab: TextTabState; result: SaveTextFileResult }
  | { status: "clean" }
  | { status: "busy" }
  | { status: "stale" }
  | { status: "failure"; error: unknown; conflict: boolean };

export type ImageLoadResult =
  | { status: "ready"; image: ImagePreview }
  | { status: "failure"; error: unknown }
  | { status: "stale" };

export interface ImageLoadRequest {
  version: number;
  completion: Promise<ImageLoadResult>;
}

type Listener = (change: EditorSessionChange) => void;

export class EditorSessionController {
  readonly state: EditorSessionState = {
    workspaceRoot: null,
    session: createEditorSession(),
  };

  private readonly gateway: EditorSessionGateway;
  private readonly listeners = new Set<Listener>();
  private workspaceGeneration = 0;
  private saveSequence = 0;
  private imageSequence = 0;
  private disposed = false;

  constructor(gateway: EditorSessionGateway) {
    this.gateway = gateway;
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  installWorkspace(root: string | null): void {
    const changed = this.state.workspaceRoot !== root;
    this.state.workspaceRoot = root;
    if (changed) {
      this.workspaceGeneration += 1;
      this.imageSequence += 1;
      this.state.session = createEditorSession();
    } else {
      this.state.session = closePreview(this.state.session);
    }
    this.emit({ reason: "workspace", documentChanged: true, tabsChanged: changed });
  }

  resetSession(): void {
    this.workspaceGeneration += 1;
    this.imageSequence += 1;
    this.state.session = createEditorSession();
    this.emit({ reason: "workspace", documentChanged: true, tabsChanged: true });
  }

  activeDocument(): EditorDocument {
    return activeEditorDocument(this.state.session);
  }

  tab(tabId: string): TextTabState | null {
    return textTab(this.state.session, tabId);
  }

  dirtyTabs(): TextTabState[] {
    return dirtyTextTabs(this.state.session);
  }

  captureText(tabId: string, content: string): void {
    const next = captureTextContent(this.state.session, tabId, content);
    if (next === this.state.session) return;
    this.state.session = next;
    this.emit({ reason: "edit", tabId, contentChanged: true });
  }

  markEdited(tabId: string, content: string): void {
    const next = markTextEdited(this.state.session, tabId, content);
    if (next === this.state.session) return;
    this.state.session = next;
    this.emit({ reason: "edit", tabId, contentChanged: true });
  }

  setMarkdownMode(tabId: string, mode: MarkdownEditorMode): void {
    const next = setTextTabMarkdownMode(this.state.session, tabId, mode);
    if (next === this.state.session) return;
    this.state.session = next;
    this.emit({ reason: "markdown-mode", tabId, contentChanged: true });
  }

  activateText(tabId: string): boolean {
    const next = activateTextTab(this.state.session, tabId);
    if (next === this.state.session) return false;
    this.state.session = next;
    this.emit({ reason: "activation", tabId, documentChanged: true });
    return true;
  }

  activatePreview(document: PreviewDocument): void {
    this.state.session = activatePreview(this.state.session, document);
    this.emit({ reason: "activation", documentChanged: true, tabsChanged: true });
  }

  reactivatePreview(): boolean {
    const preview = this.state.session.preview;
    if (!preview) return false;
    this.state.session = activatePreview(this.state.session, preview);
    this.emit({ reason: "activation", documentChanged: true });
    return true;
  }

  activateWelcome(): void {
    this.state.session = activateWelcome(this.state.session);
    this.emit({ reason: "activation", documentChanged: true });
  }

  closePreview(): void {
    this.state.session = closePreview(this.state.session);
    this.imageSequence += 1;
    this.emit({ reason: "close", documentChanged: true, tabsChanged: true });
  }

  closeText(tabId: string): boolean {
    const closed = closeTextTab(this.state.session, tabId);
    this.state.session = closed.session;
    if (!closed.blocked) {
      this.emit({ reason: "close", tabId, documentChanged: true, tabsChanged: true });
    }
    return !closed.blocked;
  }

  async openText(
    repositoryRoot: string,
    file: ProjectFile,
    markdownMode: MarkdownEditorMode,
    forceReload = false,
  ): Promise<OpenTextResult> {
    if (this.disposed || this.state.workspaceRoot !== repositoryRoot) return { status: "stale" };
    const document: ProjectFileDocument = {
      kind: "project-file",
      repositoryRoot,
      repositoryId: file.repositoryId,
      path: file.path,
      workspacePath: file.workspacePath,
    };
    const id = editorDocumentKey(document);
    const existing = textTab(this.state.session, id);
    if (existing && markdownMode !== existing.markdownMode) {
      this.state.session = setTextTabMarkdownMode(this.state.session, existing.id, markdownMode);
    }
    let opened = openTextDocument(this.state.session, document, markdownMode);
    if (opened.limitReached) return { status: "limit" };
    if (forceReload && existing?.status === "ready" && opened.tabId) {
      const reload = beginTextReload(opened.session, opened.tabId);
      if (reload.loadEpoch === null) return { status: "stale" };
      opened = { ...opened, session: reload.session, loadEpoch: reload.loadEpoch, needsLoad: true };
    }
    this.state.session = opened.session;
    this.emit({
      reason: opened.needsLoad ? "load-start" : "activation",
      tabId: opened.tabId ?? undefined,
      documentChanged: true,
      tabsChanged: !existing,
    });
    if (!opened.needsLoad || !opened.tabId || opened.loadEpoch === null) {
      const tab = opened.tabId ? textTab(this.state.session, opened.tabId) : null;
      return tab ? { status: "existing", tab } : { status: "stale" };
    }

    const generation = this.workspaceGeneration;
    try {
      const snapshot = await this.gateway.readTextFile(
        repositoryRoot,
        file.repositoryId,
        file.path,
      );
      if (!this.workspaceMatches(generation, repositoryRoot)) return { status: "stale" };
      this.state.session = completeTextLoad(
        this.state.session,
        opened.tabId,
        opened.loadEpoch,
        snapshot,
      );
      const tab = textTab(this.state.session, opened.tabId);
      if (!tab || tab.status !== "ready" || tab.revision !== snapshot.revision) {
        return { status: "stale" };
      }
      this.emit({ reason: "load-complete", tabId: tab.id, contentChanged: true });
      return { status: "ready", tab };
    } catch (error) {
      if (!this.workspaceMatches(generation, repositoryRoot)) return { status: "stale" };
      this.state.session = failTextLoad(
        this.state.session,
        opened.tabId,
        opened.loadEpoch,
        errorMessage(error),
      );
      this.emit({ reason: "load-error", tabId: opened.tabId, error: errorMessage(error) });
      return { status: "failure", error, tabId: opened.tabId };
    }
  }

  async reloadPaths(workspacePaths: Iterable<string>): Promise<void> {
    const selected = new Set(workspacePaths);
    const tabs = this.state.session.textTabs.filter((tab) =>
      selected.has(tab.document.workspacePath),
    );
    const generation = this.workspaceGeneration;
    for (const tab of tabs) {
      const reload = beginTextReload(this.state.session, tab.id);
      if (reload.loadEpoch === null) continue;
      this.state.session = reload.session;
      this.emit({ reason: "load-start", tabId: tab.id, contentChanged: true });
      try {
        const snapshot = await this.gateway.readTextFile(
          tab.document.repositoryRoot,
          tab.document.repositoryId,
          tab.document.path,
        );
        if (!this.workspaceMatches(generation, tab.document.repositoryRoot)) return;
        this.state.session = completeTextLoad(this.state.session, tab.id, reload.loadEpoch, snapshot);
        this.emit({ reason: "load-complete", tabId: tab.id, contentChanged: true });
      } catch (error) {
        if (!this.workspaceMatches(generation, tab.document.repositoryRoot)) return;
        this.state.session = failTextLoad(
          this.state.session,
          tab.id,
          reload.loadEpoch,
          errorMessage(error),
        );
        this.emit({ reason: "load-error", tabId: tab.id, error: errorMessage(error) });
      }
    }
  }

  workspacePaths(): string[] {
    return this.state.session.textTabs.map((tab) => tab.document.workspacePath);
  }

  async reconcileExternalPaths(workspacePaths: Iterable<string>): Promise<void> {
    const selected = Array.from(new Set(workspacePaths));
    const tabs = this.state.session.textTabs.filter((tab) =>
      selected.length === 0 || selected.some((path) =>
        tab.document.workspacePath === path || tab.document.workspacePath.startsWith(`${path}/`)
      )
    );
    const generation = this.workspaceGeneration;
    await Promise.all(tabs.map(async (candidate) => {
      const expectedRevision = candidate.revision;
      if (!expectedRevision || candidate.status !== "ready") return;
      try {
        const snapshot = await this.gateway.readTextFile(
          candidate.document.repositoryRoot,
          candidate.document.repositoryId,
          candidate.document.path,
        );
        if (!this.workspaceMatches(generation, candidate.document.repositoryRoot)) return;
        const reconciled = reconcileExternalTextSnapshot(
          this.state.session,
          candidate.id,
          expectedRevision,
          snapshot,
        );
        this.state.session = reconciled.session;
        if (reconciled.status === "reloaded" || reconciled.status === "conflict") {
          this.emit({
            reason: "external-change",
            tabId: candidate.id,
            contentChanged: true,
            error: reconciled.status === "conflict"
              ? "A file with unsaved edits changed outside Asterlyn. The local buffer was preserved."
              : undefined,
          });
        }
      } catch {
        if (!this.workspaceMatches(generation, candidate.document.repositoryRoot)) return;
        const message = "The file changed or became unavailable outside Asterlyn; its open buffer was preserved.";
        const next = markTextExternalConflict(
          this.state.session,
          candidate.id,
          expectedRevision,
          message,
        );
        if (next === this.state.session) return;
        this.state.session = next;
        this.emit({
          reason: "external-change",
          tabId: candidate.id,
          contentChanged: true,
          error: message,
        });
      }
    }));
  }

  async saveText(tabId: string, content: string): Promise<SaveTextResult> {
    const current = textTab(this.state.session, tabId);
    if (!current) return { status: "clean" };
    const requestId = `text-save-${Date.now()}-${++this.saveSequence}`;
    const prepared = beginTextSave(this.state.session, tabId, content, requestId);
    this.state.session = prepared.session;
    const request = prepared.request;
    if (!request) return isTextTabDirty(current) ? { status: "busy" } : { status: "clean" };
    const generation = this.workspaceGeneration;
    this.emit({ reason: "save-start", tabId, contentChanged: true });
    try {
      const result = await this.gateway.saveTextFile(
        request.document.repositoryRoot,
        request.document.repositoryId,
        request.document.path,
        request.expectedRevision,
        request.content,
        request.utf8Bom,
        request.requestId,
      );
      if (!this.workspaceMatches(generation, request.document.repositoryRoot)) {
        return { status: "stale" };
      }
      this.state.session = completeTextSave(this.state.session, tabId, result);
      const tab = textTab(this.state.session, tabId);
      if (!tab) return { status: "stale" };
      const status = isTextTabDirty(tab) ? "newer-edits" : "saved";
      this.emit({ reason: "save-complete", tabId, contentChanged: true });
      return { status, tab, result };
    } catch (error) {
      if (!this.workspaceMatches(generation, request.document.repositoryRoot)) {
        return { status: "stale" };
      }
      const conflict = isWorkspaceConflict(error);
      this.state.session = failTextSave(
        this.state.session,
        tabId,
        request.requestId,
        errorMessage(error),
        conflict,
      );
      this.emit({ reason: "save-error", tabId, error: errorMessage(error) });
      return { status: "failure", error, conflict };
    }
  }

  beginImageLoad(document: ProjectImageDocument): ImageLoadRequest {
    const version = ++this.imageSequence;
    const generation = this.workspaceGeneration;
    const completion: Promise<ImageLoadResult> = (async () => {
      if (
        this.disposed ||
        this.state.workspaceRoot !== document.repositoryRoot
      ) return { status: "stale" };
      try {
        const image = await this.gateway.readImageFile(
          document.repositoryRoot,
          document.repositoryId,
          document.path,
        );
        if (
          !this.workspaceMatches(generation, document.repositoryRoot) ||
          version !== this.imageSequence
        ) return { status: "stale" };
        return { status: "ready", image };
      } catch (error) {
        if (
          !this.workspaceMatches(generation, document.repositoryRoot) ||
          version !== this.imageSequence
        ) return { status: "stale" };
        return { status: "failure", error };
      }
    })();
    return { version, completion };
  }

  invalidateImageLoads(): void {
    this.imageSequence += 1;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.workspaceGeneration += 1;
    this.imageSequence += 1;
    this.listeners.clear();
    this.state.session = createEditorSession();
  }

  private workspaceMatches(generation: number, root: string): boolean {
    return !this.disposed &&
      generation === this.workspaceGeneration &&
      this.state.workspaceRoot === root;
  }

  private emit(change: EditorSessionChange): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener(change);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Unexpected editor-session error";
}

function isWorkspaceConflict(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "kind" in error &&
    (error as { kind: unknown }).kind === "conflict",
  );
}
