import type { WorkspaceSearchState } from "./workspace-search.ts";

export const WORKSPACE_SEARCH_DEBOUNCE_MS = 250;

export interface WorkspaceSearchSnapshot {
  workspaceMode: boolean;
  root: string | null;
  generation: number;
  query: string;
  requestCurrent: boolean;
  status: WorkspaceSearchState["status"];
}

export function hasCurrentWorkspaceSearch(
  search: WorkspaceSearchState,
  root: string,
  generation: number,
  requestCurrent: boolean,
): boolean {
  return search.request?.repositoryRoot === root &&
    search.request.repositoryGeneration === generation &&
    requestCurrent &&
    (search.status === "loading" || search.status === "ready");
}

/** Delay bounded scans until the current query and control state settle. */
export class WorkspaceSearchDebouncer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly delayMs: number;

  constructor(delayMs = WORKSPACE_SEARCH_DEBOUNCE_MS) {
    this.delayMs = delayMs;
  }

  schedule(snapshot: () => WorkspaceSearchSnapshot, run: () => void): void {
    this.cancel();
    const initial = snapshot();
    if (!initial.workspaceMode || !initial.root || initial.query.trim().length === 0) return;
    if (initial.requestCurrent && (initial.status === "loading" || initial.status === "ready")) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const current = snapshot();
      if (
        !current.workspaceMode ||
        current.root !== initial.root ||
        current.generation !== initial.generation ||
        current.query !== initial.query
      ) return;
      run();
    }, this.delayMs);
  }

  cancel(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
