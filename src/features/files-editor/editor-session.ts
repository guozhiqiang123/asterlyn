import type { SaveTextFileResult, TextFileSnapshot } from "../../models";
import type {
  EditorPathMapping,
  EditorPathMutationBlocker,
  EditorPathMutationLease,
  EditorPathMutationLeaseTab,
  EditorPathMutationRequest,
  EditorRuntimeTabRemap,
} from "../../editor-path-mutation.ts";
export type {
  EditorPathMapping,
  EditorPathMutationBlocker,
  EditorPathMutationLease,
  EditorPathMutationRequest,
  EditorRuntimeTabRemap,
} from "../../editor-path-mutation.ts";
import {
  editorDocumentKey,
  type EditorDocument,
  type ProjectFileDocument,
  type ProjectImageDocument,
} from "../../editor-document.ts";

export const TEXT_TAB_LIMIT = 20;

type PreviewDocument = Exclude<EditorDocument, { kind: "welcome" | "project-file" }>;

export type MarkdownEditorMode = "source" | "split" | "preview";

export interface TextTabState {
  id: string;
  document: ProjectFileDocument;
  status: "loading" | "ready" | "error";
  content: string;
  persistedContent: string;
  utf8Bom: boolean;
  revision: string | null;
  loadEpoch: number;
  editVersion: number;
  persistedVersion: number;
  saveRequest: {
    id: string;
    capturedVersion: number;
    capturedContent: string;
  } | null;
  error: string | null;
  conflict: boolean;
  markdownMode: MarkdownEditorMode;
}

export interface EditorSession {
  textTabs: TextTabState[];
  preview: PreviewDocument | null;
  active: { kind: "welcome" } | { kind: "text"; id: string } | { kind: "preview" };
}

export interface TextSaveRequest {
  tabId: string;
  document: ProjectFileDocument;
  requestId: string;
  expectedRevision: string;
  content: string;
  utf8Bom: boolean;
  capturedVersion: number;
}

export type ExternalTextReconciliationStatus =
  | "unchanged"
  | "reloaded"
  | "conflict"
  | "stale";

export type EditorPathMutationPreparation =
  | { status: "ready"; lease: EditorPathMutationLease }
  | { status: "blocked"; reason: EditorPathMutationBlocker };

export type EditorPathMutationApplication =
  | {
      status: "applied";
      session: EditorSession;
      remaps: EditorRuntimeTabRemap[];
      disposedTabIds: string[];
    }
  | { status: "stale" };

export function createEditorSession(): EditorSession {
  return { textTabs: [], preview: null, active: { kind: "welcome" } };
}

export function prepareEditorPathMutation(
  session: EditorSession,
  request: EditorPathMutationRequest,
): EditorPathMutationPreparation {
  if (!validMutationRequest(request)) {
    return { status: "blocked", reason: "invalidMapping" };
  }
  const sourceWorkspacePath = request.kind === "move"
    ? request.mapping.sourceWorkspacePath
    : request.sourceWorkspacePath;
  const affected = session.textTabs.filter((tab) =>
    isAtOrBelow(tab.document.workspacePath, sourceWorkspacePath)
  );
  if (affected.some((tab) => tab.saveRequest !== null)) {
    return { status: "blocked", reason: "saveInFlight" };
  }
  if (affected.some((tab) => tab.status === "loading")) {
    return { status: "blocked", reason: "sourceLoading" };
  }
  if (request.kind === "trash" && affected.some(isTextTabDirty)) {
    return { status: "blocked", reason: "dirtyDelete" };
  }
  if (request.kind === "move") {
    const destinations = affected.map((tab) => remapProjectDocument(tab.document, request.mapping));
    if (destinations.some((document) => document === null)) {
      return { status: "blocked", reason: "invalidMapping" };
    }
    const affectedIds = new Set(affected.map((tab) => tab.id));
    const destinationIds = destinations.map((document) => editorDocumentKey(document!));
    if (
      new Set(destinationIds).size !== destinationIds.length ||
      session.textTabs.some((tab) =>
        !affectedIds.has(tab.id) && destinationIds.includes(tab.id)
      )
    ) {
      return { status: "blocked", reason: "destinationOpen" };
    }
  }
  return {
    status: "ready",
    lease: {
      request,
      tabs: affected.map(leaseTab),
    },
  };
}

export function applyEditorPathMutation(
  session: EditorSession,
  lease: EditorPathMutationLease,
): EditorPathMutationApplication {
  const refreshed = prepareEditorPathMutation(session, lease.request);
  if (
    refreshed.status !== "ready" ||
    !sameLeaseTabs(refreshed.lease.tabs, lease.tabs)
  ) {
    return { status: "stale" };
  }
  const affectedIds = new Set(lease.tabs.map((tab) => tab.id));
  if (lease.request.kind === "trash") {
    let next = session;
    for (const tabId of affectedIds) {
      const closed = closeTextTab(next, tabId);
      if (closed.blocked) return { status: "stale" };
      next = closed.session;
    }
    if (
      next.preview?.kind === "project-image" &&
      isAtOrBelow(next.preview.workspacePath, lease.request.sourceWorkspacePath)
    ) {
      next = closePreview(next);
    }
    return {
      status: "applied",
      session: next,
      remaps: [],
      disposedTabIds: [...affectedIds],
    };
  }

  const mapping = lease.request.mapping;
  const remaps: EditorRuntimeTabRemap[] = [];
  const textTabs = session.textTabs.map((tab) => {
    if (!affectedIds.has(tab.id)) return tab;
    const document = remapProjectDocument(tab.document, mapping);
    if (!document) return tab;
    const id = editorDocumentKey(document);
    remaps.push({ sourceId: tab.id, destinationId: id, destinationPath: document.path });
    return { ...tab, id, document };
  });
  const idRemaps = new Map(remaps.map((remap) => [remap.sourceId, remap.destinationId]));
  const preview = session.preview?.kind === "project-image"
    ? remapProjectDocument(session.preview, mapping) ?? session.preview
    : session.preview;
  return {
    status: "applied",
    session: {
      ...session,
      textTabs,
      preview,
      active: session.active.kind === "text" && idRemaps.has(session.active.id)
        ? { kind: "text", id: idRemaps.get(session.active.id)! }
        : session.active,
    },
    remaps,
    disposedTabIds: [],
  };
}

export function activeEditorDocument(session: EditorSession): EditorDocument {
  if (session.active.kind === "text") {
    const activeId = session.active.id;
    return (
      session.textTabs.find((tab) => tab.id === activeId)?.document ?? {
        kind: "welcome",
      }
    );
  }
  if (session.active.kind === "preview") {
    return session.preview ?? { kind: "welcome" };
  }
  return { kind: "welcome" };
}

export function openTextDocument(
  session: EditorSession,
  document: ProjectFileDocument,
  initialMarkdownMode: MarkdownEditorMode = "source",
): {
  session: EditorSession;
  tabId: string | null;
  loadEpoch: number | null;
  needsLoad: boolean;
  limitReached: boolean;
} {
  const id = editorDocumentKey(document);
  const existing = session.textTabs.find((tab) => tab.id === id);
  if (existing) {
    const retry = existing.status === "error";
    const loadEpoch = retry ? existing.loadEpoch + 1 : existing.loadEpoch;
    return {
      session: {
        ...session,
        textTabs: session.textTabs.map((tab) =>
          tab.id === id
            ? {
                ...tab,
                document,
                ...(retry ? { status: "loading" as const, loadEpoch, error: null } : {}),
              }
            : tab,
        ),
        active: { kind: "text", id },
      },
      tabId: id,
      loadEpoch,
      needsLoad: retry,
      limitReached: false,
    };
  }
  let textTabs = session.textTabs;
  if (textTabs.length >= TEXT_TAB_LIMIT) {
    // The bound limits retained editor state, not navigation. Retire an old
    // clean buffer automatically, while dirty and in-flight saves remain
    // non-evictable data-loss boundaries.
    const inactiveCleanIndex = textTabs.findIndex(
      (tab) =>
        (session.active.kind !== "text" || session.active.id !== tab.id) &&
        tab.saveRequest === null &&
        !isTextTabDirty(tab),
    );
    const cleanIndex =
      inactiveCleanIndex >= 0
        ? inactiveCleanIndex
        : textTabs.findIndex(
            (tab) => tab.saveRequest === null && !isTextTabDirty(tab),
          );
    if (cleanIndex >= 0) {
      textTabs = textTabs.filter((_tab, index) => index !== cleanIndex);
    }
  }
  if (textTabs.length >= TEXT_TAB_LIMIT) {
    return {
      session,
      tabId: null,
      loadEpoch: null,
      needsLoad: false,
      limitReached: true,
    };
  }
  const tab: TextTabState = {
    id,
    document,
    status: "loading",
    content: "",
    persistedContent: "",
    utf8Bom: false,
    revision: null,
    loadEpoch: 1,
    editVersion: 0,
    persistedVersion: 0,
    saveRequest: null,
    error: null,
    conflict: false,
    markdownMode: initialMarkdownMode,
  };
  return {
    session: {
      ...session,
      textTabs: [...textTabs, tab],
      active: { kind: "text", id },
    },
    tabId: id,
    loadEpoch: 1,
    needsLoad: true,
    limitReached: false,
  };
}

export function completeTextLoad(
  session: EditorSession,
  tabId: string,
  loadEpoch: number,
  snapshot: TextFileSnapshot,
): EditorSession {
  return updateMatchingTab(session, tabId, (tab) =>
    tab.loadEpoch !== loadEpoch || tab.document.workspacePath !== snapshot.workspacePath
      ? tab
      : {
          ...tab,
          status: "ready",
          content: snapshot.content,
          persistedContent: snapshot.content,
          utf8Bom: snapshot.utf8Bom,
          revision: snapshot.revision,
          editVersion: 0,
          persistedVersion: 0,
          error: null,
          conflict: false,
        },
  );
}

export function reconcileExternalTextSnapshot(
  session: EditorSession,
  tabId: string,
  expectedRevision: string,
  snapshot: TextFileSnapshot,
): { session: EditorSession; status: ExternalTextReconciliationStatus } {
  const tab = textTab(session, tabId);
  if (
    !tab ||
    tab.status !== "ready" ||
    tab.revision !== expectedRevision ||
    tab.document.workspacePath !== snapshot.workspacePath
  ) {
    return { session, status: "stale" };
  }
  if (snapshot.revision === tab.revision) return { session, status: "unchanged" };
  if (tab.saveRequest || isTextTabDirty(tab)) {
    return {
      session: markTextExternalConflict(
        session,
        tabId,
        expectedRevision,
        "The file changed outside Asterlyn; the unsaved buffer was preserved.",
      ),
      status: "conflict",
    };
  }
  return {
    session: updateMatchingTab(session, tabId, (current) => ({
      ...current,
      content: snapshot.content,
      persistedContent: snapshot.content,
      utf8Bom: snapshot.utf8Bom,
      revision: snapshot.revision,
      loadEpoch: current.loadEpoch + 1,
      persistedVersion: current.editVersion,
      error: null,
      conflict: false,
    })),
    status: "reloaded",
  };
}

export function markTextExternalConflict(
  session: EditorSession,
  tabId: string,
  expectedRevision: string,
  error: string,
): EditorSession {
  return updateMatchingTab(session, tabId, (tab) =>
    tab.status !== "ready" || tab.revision !== expectedRevision ||
      (tab.conflict && tab.error === error)
      ? tab
      : { ...tab, conflict: true, error },
  );
}

export function beginTextReload(
  session: EditorSession,
  tabId: string,
): { session: EditorSession; loadEpoch: number | null } {
  const tab = session.textTabs.find((candidate) => candidate.id === tabId);
  if (
    !tab ||
    tab.status !== "ready" ||
    tab.saveRequest !== null ||
    isTextTabDirty(tab)
  ) {
    return { session, loadEpoch: null };
  }
  const loadEpoch = tab.loadEpoch + 1;
  return {
    session: updateMatchingTab(session, tabId, (candidate) => ({
      ...candidate,
      status: "loading",
      loadEpoch,
      error: null,
      conflict: false,
    })),
    loadEpoch,
  };
}

export function failTextLoad(
  session: EditorSession,
  tabId: string,
  loadEpoch: number,
  error: string,
): EditorSession {
  return updateMatchingTab(session, tabId, (tab) =>
    tab.loadEpoch !== loadEpoch
      ? tab
      : { ...tab, status: "error", error, conflict: false },
  );
}

export function activateTextTab(session: EditorSession, tabId: string): EditorSession {
  return session.textTabs.some((tab) => tab.id === tabId)
    ? { ...session, active: { kind: "text", id: tabId } }
    : session;
}

export function activatePreview(
  session: EditorSession,
  document: PreviewDocument,
): EditorSession {
  return { ...session, preview: document, active: { kind: "preview" } };
}

export function activateWelcome(session: EditorSession): EditorSession {
  return { ...session, active: { kind: "welcome" } };
}

export function markTextEdited(
  session: EditorSession,
  tabId: string,
  content: string,
): EditorSession {
  return updateMatchingTab(session, tabId, (tab) =>
    tab.document.readOnly === true || tab.status !== "ready" || tab.content === content
      ? tab
      : {
          ...tab,
          content,
          editVersion: tab.editVersion + 1,
          error: null,
        },
  );
}

export function setTextTabMarkdownMode(
  session: EditorSession,
  tabId: string,
  markdownMode: MarkdownEditorMode,
): EditorSession {
  return updateMatchingTab(session, tabId, (tab) =>
    tab.markdownMode === markdownMode ? tab : { ...tab, markdownMode },
  );
}

export function captureTextContent(
  session: EditorSession,
  tabId: string,
  content: string,
): EditorSession {
  return updateMatchingTab(session, tabId, (tab) =>
    tab.document.readOnly === true || tab.status !== "ready" || tab.content === content
      ? tab
      : { ...tab, content },
  );
}

export function beginTextSave(
  session: EditorSession,
  tabId: string,
  content: string,
  requestId: string,
): { session: EditorSession; request: TextSaveRequest | null } {
  const tab = session.textTabs.find((candidate) => candidate.id === tabId);
  if (
    !tab ||
    tab.document.readOnly === true ||
    tab.status !== "ready" ||
    tab.revision === null ||
    tab.saveRequest !== null ||
    !isTextTabDirty(tab)
  ) {
    return { session, request: null };
  }
  const capturedVersion = tab.editVersion;
  const request: TextSaveRequest = {
    tabId,
    document: tab.document,
    requestId,
    expectedRevision: tab.revision,
    content,
    utf8Bom: tab.utf8Bom,
    capturedVersion,
  };
  return {
    session: updateMatchingTab(session, tabId, (candidate) => ({
      ...candidate,
      content,
      saveRequest: { id: requestId, capturedVersion, capturedContent: content },
      error: null,
      conflict: false,
    })),
    request,
  };
}

export function completeTextSave(
  session: EditorSession,
  tabId: string,
  result: SaveTextFileResult,
): EditorSession {
  return updateMatchingTab(session, tabId, (tab) => {
    if (
      tab.saveRequest?.id !== result.requestId ||
      tab.document.workspacePath !== result.workspacePath
    ) {
      return tab;
    }
    return {
      ...tab,
      revision: result.revision,
      persistedContent: tab.saveRequest.capturedContent,
      persistedVersion: tab.saveRequest.capturedVersion,
      saveRequest: null,
      error: null,
      conflict: false,
    };
  });
}

export function failTextSave(
  session: EditorSession,
  tabId: string,
  requestId: string,
  error: string,
  conflict: boolean,
): EditorSession {
  return updateMatchingTab(session, tabId, (tab) =>
    tab.saveRequest?.id !== requestId
      ? tab
      : { ...tab, saveRequest: null, error, conflict },
  );
}

export function closeTextTab(
  session: EditorSession,
  tabId: string,
): { session: EditorSession; blocked: boolean } {
  const index = session.textTabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return { session, blocked: false };
  const tab = session.textTabs[index]!;
  if (isTextTabDirty(tab) || tab.saveRequest !== null) {
    return { session, blocked: true };
  }
  const textTabs = session.textTabs.filter((candidate) => candidate.id !== tabId);
  let active = session.active;
  if (active.kind === "text" && active.id === tabId) {
    const neighbor = textTabs[Math.min(index, textTabs.length - 1)];
    active = neighbor
      ? { kind: "text", id: neighbor.id }
      : session.preview
        ? { kind: "preview" }
        : { kind: "welcome" };
  }
  return { session: { ...session, textTabs, active }, blocked: false };
}

export function closePreview(session: EditorSession): EditorSession {
  return {
    ...session,
    preview: null,
    active:
      session.active.kind === "preview"
        ? session.textTabs.at(-1)
          ? { kind: "text", id: session.textTabs.at(-1)!.id }
          : { kind: "welcome" }
        : session.active,
  };
}

export function textTab(session: EditorSession, tabId: string): TextTabState | null {
  return session.textTabs.find((tab) => tab.id === tabId) ?? null;
}

export function activeTextTab(session: EditorSession): TextTabState | null {
  return session.active.kind === "text" ? textTab(session, session.active.id) : null;
}

export function dirtyTextTabs(session: EditorSession): TextTabState[] {
  return session.textTabs.filter(isTextTabDirty);
}

export function isTextTabDirty(tab: TextTabState): boolean {
  return tab.document.readOnly !== true && tab.content !== tab.persistedContent;
}

function leaseTab(tab: TextTabState): EditorPathMutationLeaseTab {
  return {
    id: tab.id,
    loadEpoch: tab.loadEpoch,
    revision: tab.revision,
    persistedContent: tab.persistedContent,
  };
}

function sameLeaseTabs(
  left: readonly EditorPathMutationLeaseTab[],
  right: readonly EditorPathMutationLeaseTab[],
): boolean {
  return left.length === right.length && left.every((tab, index) => {
    const other = right[index];
    return other !== undefined &&
      tab.id === other.id &&
      tab.loadEpoch === other.loadEpoch &&
      tab.revision === other.revision &&
      tab.persistedContent === other.persistedContent;
  });
}

function validMutationRequest(request: EditorPathMutationRequest): boolean {
  if (request.kind === "trash") return validRelativePrefix(request.sourceWorkspacePath);
  const mapping = request.mapping;
  return validRelativePrefix(mapping.sourceWorkspacePath) &&
    validRelativePrefix(mapping.destinationWorkspacePath) &&
    validRelativePrefix(mapping.sourcePath) &&
    validRelativePrefix(mapping.destinationPath) &&
    Boolean(mapping.sourceRepositoryId) &&
    Boolean(mapping.destinationRepositoryId) &&
    mapping.sourceWorkspacePath !== mapping.destinationWorkspacePath;
}

function validRelativePrefix(path: string): boolean {
  return path.length > 0 &&
    path.length <= 4_096 &&
    !path.includes("\\") &&
    !path.startsWith("/") &&
    !path.endsWith("/") &&
    path.split("/").every((component) => component !== "" && component !== "." && component !== "..");
}

function isAtOrBelow(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function remapPrefix(path: string, source: string, destination: string): string | null {
  if (path === source) return destination;
  return path.startsWith(`${source}/`)
    ? `${destination}${path.slice(source.length)}`
    : null;
}

function remapProjectDocument<
  Document extends ProjectFileDocument | ProjectImageDocument,
>(document: Document, mapping: EditorPathMapping): Document | null {
  if (document.repositoryId !== mapping.sourceRepositoryId) return null;
  const workspacePath = remapPrefix(
    document.workspacePath,
    mapping.sourceWorkspacePath,
    mapping.destinationWorkspacePath,
  );
  const path = remapPrefix(document.path, mapping.sourcePath, mapping.destinationPath);
  if (!workspacePath || !path) return null;
  return {
    ...document,
    repositoryId: mapping.destinationRepositoryId,
    workspacePath,
    path,
  };
}

function updateMatchingTab(
  session: EditorSession,
  tabId: string,
  update: (tab: TextTabState) => TextTabState,
): EditorSession {
  let changed = false;
  const textTabs = session.textTabs.map((tab) => {
    if (tab.id !== tabId) return tab;
    const next = update(tab);
    changed ||= next !== tab;
    return next;
  });
  return changed ? { ...session, textTabs } : session;
}
