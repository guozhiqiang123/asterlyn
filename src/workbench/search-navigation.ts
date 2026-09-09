import type { WorkspaceTextSearchMatch } from "../models";
import { isTextTabDirty, type TextTabState } from "./editor-session.ts";

export type SearchNavigationDecision =
  | "ready"
  | "wrongWorkspace"
  | "wrongDocument"
  | "notReady"
  | "dirty"
  | "staleRevision"
  | "invalidRange";

export function evaluateSearchNavigation(
  activeRepositoryRoot: string | null,
  tab: TextTabState,
  match: WorkspaceTextSearchMatch,
): SearchNavigationDecision {
  if (
    !activeRepositoryRoot ||
    tab.document.repositoryRoot !== activeRepositoryRoot
  ) {
    return "wrongWorkspace";
  }
  if (
    tab.document.repositoryId !== match.repositoryId ||
    tab.document.path !== match.path ||
    tab.document.workspacePath !== match.workspacePath
  ) {
    return "wrongDocument";
  }
  if (tab.status !== "ready" || tab.revision === null) return "notReady";
  if (isTextTabDirty(tab) || tab.saveRequest !== null) return "dirty";
  if (tab.revision !== match.revision) return "staleRevision";
  if (
    !Number.isInteger(match.fromUtf16) ||
    !Number.isInteger(match.toUtf16) ||
    match.fromUtf16 < 0 ||
    match.toUtf16 < match.fromUtf16 ||
    match.toUtf16 > tab.content.length
  ) {
    return "invalidRange";
  }
  return "ready";
}
