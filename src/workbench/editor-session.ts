import type { SaveTextFileResult, TextFileSnapshot } from "../models";
import {
  editorDocumentKey,
  type EditorDocument,
  type ProjectFileDocument,
} from "./editor-document.ts";

export const TEXT_TAB_LIMIT = 20;

type PreviewDocument = Exclude<EditorDocument, { kind: "welcome" | "project-file" }>;

export interface TextTabState {
  id: string;
  document: ProjectFileDocument;
  status: "loading" | "ready" | "error";
  content: string;
  utf8Bom: boolean;
  revision: string | null;
  loadEpoch: number;
  editVersion: number;
  persistedVersion: number;
  saveRequest: { id: string; capturedVersion: number } | null;
  error: string | null;
  conflict: boolean;
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

export function createEditorSession(): EditorSession {
  return { textTabs: [], preview: null, active: { kind: "welcome" } };
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
        textTabs: retry
          ? session.textTabs.map((tab) =>
              tab.id === id
                ? { ...tab, status: "loading", loadEpoch, error: null }
                : tab,
            )
          : session.textTabs,
        active: { kind: "text", id },
      },
      tabId: id,
      loadEpoch,
      needsLoad: retry,
      limitReached: false,
    };
  }
  if (session.textTabs.length >= TEXT_TAB_LIMIT) {
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
    utf8Bom: false,
    revision: null,
    loadEpoch: 1,
    editVersion: 0,
    persistedVersion: 0,
    saveRequest: null,
    error: null,
    conflict: false,
  };
  return {
    session: {
      ...session,
      textTabs: [...session.textTabs, tab],
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
          utf8Bom: snapshot.utf8Bom,
          revision: snapshot.revision,
          editVersion: 0,
          persistedVersion: 0,
          error: null,
          conflict: false,
        },
  );
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

export function markTextEdited(session: EditorSession, tabId: string): EditorSession {
  return updateMatchingTab(session, tabId, (tab) =>
    tab.status !== "ready"
      ? tab
      : { ...tab, editVersion: tab.editVersion + 1, error: null, conflict: false },
  );
}

export function captureTextContent(
  session: EditorSession,
  tabId: string,
  content: string,
): EditorSession {
  return updateMatchingTab(session, tabId, (tab) => ({ ...tab, content }));
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
      saveRequest: { id: requestId, capturedVersion },
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
  return tab.editVersion !== tab.persistedVersion;
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
