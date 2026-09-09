import type {
  WorkspaceTextSearchMode,
  WorkspaceTextSearchOptions,
  WorkspaceTextSearchReport,
} from "../models";

export interface WorkspaceSearchControls {
  mode: WorkspaceTextSearchMode;
  includeText: string;
  excludeText: string;
  contextLines: number;
}

export function createWorkspaceSearchControls(): WorkspaceSearchControls {
  return {
    mode: "literal",
    includeText: "",
    excludeText: "",
    contextLines: 0,
  };
}

export function workspaceSearchOptions(
  controls: WorkspaceSearchControls,
): WorkspaceTextSearchOptions {
  return {
    mode: controls.mode,
    includeGlobs: parsePathGlobs(controls.includeText),
    excludeGlobs: parsePathGlobs(controls.excludeText),
    contextLines: controls.contextLines,
  };
}

export function parsePathGlobs(value: string): string[] {
  return value
    .split(",")
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
}

export interface WorkspaceSearchRequest {
  generation: number;
  repositoryGeneration: number;
  repositoryRoot: string;
  requestId: string;
  query: string;
  options: WorkspaceTextSearchOptions;
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
  options: WorkspaceTextSearchOptions,
): { state: WorkspaceSearchState; request: WorkspaceSearchRequest } {
  const request: WorkspaceSearchRequest = {
    generation: state.generation + 1,
    repositoryGeneration,
    repositoryRoot,
    requestId,
    query,
    options: cloneOptions(options),
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
    active.query === request.query &&
    sameOptions(active.options, request.options)
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
  const catalog = report.eligibleCandidates === report.catalogCandidates
    ? `${report.filesSearched}/${report.catalogCandidates} files`
    : `${report.filesSearched}/${report.eligibleCandidates} eligible · ${report.catalogCandidates} catalog`;
  const base = `${report.matches.length} matches · ${catalog} · ${size}`;
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

export function sameWorkspaceSearchOptions(
  left: WorkspaceTextSearchOptions,
  right: WorkspaceTextSearchOptions,
): boolean {
  return sameOptions(left, right);
}

function sameOptions(
  left: WorkspaceTextSearchOptions,
  right: WorkspaceTextSearchOptions,
): boolean {
  return (
    left.mode === right.mode &&
    left.contextLines === right.contextLines &&
    sameStrings(left.includeGlobs, right.includeGlobs) &&
    sameStrings(left.excludeGlobs, right.excludeGlobs)
  );
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function cloneOptions(options: WorkspaceTextSearchOptions): WorkspaceTextSearchOptions {
  return {
    ...options,
    includeGlobs: [...options.includeGlobs],
    excludeGlobs: [...options.excludeGlobs],
  };
}
