import type { FileChange, RepositorySnapshot } from "../../models.ts";
import type { HistoricalFileDocument, ProjectFileDocument } from "../../editor-document.ts";
import type { HistoryQueryIntent } from "../../application/workbench-navigation.ts";
import { defaultHistoryQuery } from "../../history-query.ts";
import { findFileChange } from "../../change-identity.ts";
import type { TextTabState } from "./editor-session.ts";
import type { EditorContentHandle, EditorFileContext } from "./editor-content-context.ts";
import type { ContextMenuAvailability } from "../../shared/context-menu/context-menu-model.ts";

export interface EditorFileContextSource {
  readonly root: string | null;
  readonly generation: number;
  readonly snapshot: RepositorySnapshot | null;
  readonly tab: TextTabState | null;
  readonly busy: boolean;
}
export function createEditorFileContext(handle: EditorContentHandle, options: {
  source(): EditorFileContextSource;
  headOid(snapshot: RepositorySnapshot, repositoryId: string): string | null;
  reasons: { readonly unavailable: string; readonly busy: string; readonly saveFirst: string; readonly readOnly: string; readonly restoreUnavailable: string };
  reveal(document: ProjectFileDocument): void | Promise<void>;
  history(intent: HistoryQueryIntent): void;
  diff(change: FileChange): void;
  compareBuffer(source: HistoricalFileDocument): void;
  restore(change: FileChange): void | Promise<void>;
  confirmBufferRollback(path: string): Promise<boolean>;
}): EditorFileContext | null {
  const source = { ...options.source() }, tab = source.tab;
  if (!tab || tab.id !== handle.tabId || tab.loadEpoch !== handle.loadEpoch || tab.status !== "ready" ||
      tab.document.path !== handle.path || tab.document.repositoryRoot !== source.root) return null;
  const document = { ...tab.document }, version = tab.editVersion, epoch = tab.loadEpoch;
  const persistedContent = tab.persistedContent;
  const snapshot = source.snapshot;
  const change = snapshot && findFileChange(snapshot.changes, document.repositoryId, document.path);
  const repository = snapshot?.repositoryRoots.find(root => root.id === document.repositoryId);
  const head = snapshot ? options.headOid(snapshot, document.repositoryId) : null;
  const untracked = change?.indexStatus === "untracked" || change?.worktreeStatus === "untracked";
  const hasHistory = !document.ignored && !untracked && change?.indexStatus !== "added" && change?.indexStatus !== "copied";
  const enabled = { kind: "enabled" } as const;
  const blocked = (reason: string): ContextMenuAvailability => ({ kind: "blocked", reason });
  const writable = document.readOnly ? blocked(options.reasons.readOnly)
    : source.busy || tab.saveRequest ? blocked(options.reasons.busy) : enabled;
  const historyAvailable = Boolean(snapshot && repository && !document.readOnly && hasHistory && head);
  const diffAvailable = Boolean(snapshot && (change || (tab.dirty && head && hasHistory)));
  const canRestoreDisk = Boolean(change && document.repositoryId === "." && snapshot && !snapshot.branch.unborn &&
    !change.conflicted && !change.submodule && !document.ignored && !untracked && change.indexStatus !== "copied");
  const current = () => {
    const next = options.source(), currentTab = next.tab;
    return next.root === source.root && next.generation === source.generation && next.snapshot === snapshot &&
      next.busy === source.busy && currentTab?.id === tab.id && currentTab.loadEpoch === epoch && currentTab.editVersion === version &&
      currentTab.status === "ready" && currentTab.saveRequest === tab.saveRequest &&
      currentTab.document.path === document.path && currentTab.document.readOnly === document.readOnly;
  };
  return {
    changed: Boolean(change || tab.dirty), isCurrent: current,
    reveal: enabled,
    history: historyAvailable ? enabled : blocked(options.reasons.unavailable),
    diff: diffAvailable ? enabled : blocked(options.reasons.unavailable),
    rollback: writable.kind !== "enabled" ? writable
      : change && tab.dirty ? blocked(options.reasons.saveFirst)
      : change ? canRestoreDisk ? enabled : blocked(options.reasons.restoreUnavailable)
      : tab.dirty ? enabled : blocked(options.reasons.restoreUnavailable),
    revealFile: () => options.reveal(document),
    showHistory: () => {
      if (!current() || !historyAvailable || !source.root) return;
      const query = defaultHistoryQuery();
      query.repositoryIds = [document.repositoryId];
      query.paths = [...new Set([document.path, change?.originalPath].filter((path): path is string => Boolean(path)))].map(path => ({ repositoryId: document.repositoryId, path }));
      options.history({ workspaceRoot: source.root, workspaceGeneration: source.generation, query });
    },
    showDiff: () => {
      if (!current() || !diffAvailable) return;
      if (tab.dirty && head && hasHistory) options.compareBuffer({
        kind: "historical-file", repositoryRoot: document.repositoryRoot, repositoryId: document.repositoryId,
        path: document.path, originalPath: change?.originalPath ?? null, commitOid: head, status: change?.originalPath ? "renamed" : "modified",
      });
      else if (change) options.diff(change);
    },
    rollBack: async request => {
      if (!current() || writable.kind !== "enabled") return;
      if (change) {
        if (!tab.dirty && canRestoreDisk) await options.restore(change);
      } else if (tab.dirty && await options.confirmBufferRollback(document.workspacePath) && current() && request.isCurrent()) {
        request.replaceDocument(persistedContent);
      }
    },
  };
}
