import type { WorkspaceTextSearchReport } from "../models";

export interface WorkspaceSearchRequest {
  generation: number;
  repositoryGeneration: number;
  repositoryRoot: string;
  requestId: string;
  query: string;
}

export interface WorkspaceSearchState {
  generation: number;
  status: "idle" | "loading" | "ready" | "error";
  request: WorkspaceSearchRequest | null;
  report: WorkspaceTextSearchReport | null;
  error: string | null;
}

export function createWorkspaceSearchState(): WorkspaceSearchState {
  return {
    generation: 0,
    status: "idle",
    request: null,
    report: null,
    error: null,
  };
}

export function beginWorkspaceSearch(
  state: WorkspaceSearchState,
  repositoryGeneration: number,
  repositoryRoot: string,
  requestId: string,
  query: string,
): { state: WorkspaceSearchState; request: WorkspaceSearchRequest } {
  const request: WorkspaceSearchRequest = {
    generation: state.generation + 1,
    repositoryGeneration,
    repositoryRoot,
    requestId,
    query,
  };
  return {
    state: {
      generation: request.generation,
      status: "loading",
      request,
      report: null,
      error: null,
    },
    request,
  };
}

export function completeWorkspaceSearch(
  state: WorkspaceSearchState,
  request: WorkspaceSearchRequest,
  report: WorkspaceTextSearchReport,
): WorkspaceSearchState {
  if (!matchesRequest(state, request) || report.requestId !== request.requestId) {
    return state;
  }
  return { ...state, status: "ready", report, error: null };
}

export function failWorkspaceSearch(
  state: WorkspaceSearchState,
  request: WorkspaceSearchRequest,
  error: string,
): WorkspaceSearchState {
  return matchesRequest(state, request)
    ? { ...state, status: "error", report: null, error }
    : state;
}

export function invalidateWorkspaceSearch(
  state: WorkspaceSearchState,
): WorkspaceSearchState {
  return {
    generation: state.generation + 1,
    status: "idle",
    request: null,
    report: null,
    error: null,
  };
}

export function matchesRequest(
  state: WorkspaceSearchState,
  request: WorkspaceSearchRequest,
): boolean {
  const active = state.request;
  return (
    active !== null &&
    state.generation === request.generation &&
    active.generation === request.generation &&
    active.repositoryGeneration === request.repositoryGeneration &&
    active.repositoryRoot === request.repositoryRoot &&
    active.requestId === request.requestId &&
    active.query === request.query
  );
}

export function formatWorkspaceSearchCoverage(
  report: WorkspaceTextSearchReport,
): string {
  const size =
    report.bytesRead < 1024
      ? `${report.bytesRead} B`
      : report.bytesRead < 1024 * 1024
        ? `${Math.max(1, Math.round(report.bytesRead / 1024))} KiB`
        : `${(report.bytesRead / (1024 * 1024)).toFixed(1)} MiB`;
  const base = `${report.matches.length} matches · ${report.filesSearched}/${report.catalogCandidates} files · ${size}`;
  if (report.coverageReasons.length === 0) return `${base} · complete`;
  const labels: Record<(typeof report.coverageReasons)[number], string> = {
    catalogTruncated: "catalog limit",
    candidateLimit: "candidate limit",
    byteLimit: "byte limit",
    matchLimit: "match limit",
    skippedFiles: `${report.skippedCount} skipped`,
  };
  return `${base} · partial: ${report.coverageReasons.map((reason) => labels[reason]).join(", ")}`;
}
