import type {
  ReplacementApplyResult,
  ReplacementRecoverySummary,
  WorkspaceReplacementPreview,
  WorkspaceTextSearchOptions,
} from "../models";
import { sameWorkspaceSearchOptions } from "./workspace-search.ts";

export interface WorkspaceReplacementRequest {
  generation: number;
  repositoryGeneration: number;
  repositoryRoot: string;
  operationId: string;
  query: string;
  replacement: string;
  options: WorkspaceTextSearchOptions;
}

export interface WorkspaceReplacementState {
  generation: number;
  status: "idle" | "previewing" | "ready" | "applying" | "error";
  request: WorkspaceReplacementRequest | null;
  preview: WorkspaceReplacementPreview | null;
  selectedPaths: Set<string>;
  error: string | null;
  recoveries: ReplacementRecoverySummary[];
  recoveriesLoading: boolean;
}

export function createWorkspaceReplacementState(): WorkspaceReplacementState {
  return {
    generation: 0,
    status: "idle",
    request: null,
    preview: null,
    selectedPaths: new Set(),
    error: null,
    recoveries: [],
    recoveriesLoading: false,
  };
}

export function beginReplacementPreview(
  state: WorkspaceReplacementState,
  repositoryGeneration: number,
  repositoryRoot: string,
  operationId: string,
  query: string,
  replacement: string,
  options: WorkspaceTextSearchOptions,
): { state: WorkspaceReplacementState; request: WorkspaceReplacementRequest } {
  const request: WorkspaceReplacementRequest = {
    generation: state.generation + 1,
    repositoryGeneration,
    repositoryRoot,
    operationId,
    query,
    replacement,
    options: cloneOptions(options),
  };
  return {
    state: {
      ...state,
      generation: request.generation,
      status: "previewing",
      request,
      preview: null,
      selectedPaths: new Set(),
      error: null,
    },
    request,
  };
}

export function completeReplacementPreview(
  state: WorkspaceReplacementState,
  request: WorkspaceReplacementRequest,
  preview: WorkspaceReplacementPreview,
): WorkspaceReplacementState {
  if (!matchesReplacementRequest(state, request) || preview.planId !== request.operationId) {
    return state;
  }
  return {
    ...state,
    status: "ready",
    preview,
    selectedPaths: new Set(preview.files.map((file) => file.workspacePath)),
    error: null,
  };
}

export function beginReplacementApply(
  state: WorkspaceReplacementState,
): WorkspaceReplacementState {
  return state.status === "ready" && state.preview && state.selectedPaths.size > 0
    ? { ...state, status: "applying", error: null }
    : state;
}

export function completeReplacementApply(
  state: WorkspaceReplacementState,
  request: WorkspaceReplacementRequest,
  result: ReplacementApplyResult,
): WorkspaceReplacementState {
  if (!matchesReplacementRequest(state, request)) return state;
  const recoveries = result.status === "applied"
    ? [
        ...state.recoveries.filter((recovery) => recovery.recoveryId !== result.recoveryId),
        { recoveryId: result.recoveryId, status: result.status, files: result.files },
      ]
    : state.recoveries;
  return {
    ...state,
    status: "idle",
    request: null,
    preview: null,
    selectedPaths: new Set(),
    error: result.message,
    recoveries,
  };
}

export function failReplacement(
  state: WorkspaceReplacementState,
  request: WorkspaceReplacementRequest,
  error: string,
): WorkspaceReplacementState {
  return matchesReplacementRequest(state, request)
    ? { ...state, status: "error", error }
    : state;
}

export function toggleReplacementFile(
  state: WorkspaceReplacementState,
  workspacePath: string,
): WorkspaceReplacementState {
  if (state.status !== "ready" || !state.preview?.files.some((file) => file.workspacePath === workspacePath)) {
    return state;
  }
  const selectedPaths = new Set(state.selectedPaths);
  if (selectedPaths.has(workspacePath)) selectedPaths.delete(workspacePath);
  else selectedPaths.add(workspacePath);
  return { ...state, selectedPaths };
}

export function selectAllReplacementFiles(
  state: WorkspaceReplacementState,
  selected: boolean,
): WorkspaceReplacementState {
  if (state.status !== "ready" || !state.preview) return state;
  return {
    ...state,
    selectedPaths: selected
      ? new Set(state.preview.files.map((file) => file.workspacePath))
      : new Set(),
  };
}

export function closeReplacementPreview(
  state: WorkspaceReplacementState,
): WorkspaceReplacementState {
  return {
    ...state,
    generation: state.generation + 1,
    status: "idle",
    request: null,
    preview: null,
    selectedPaths: new Set(),
    error: null,
  };
}

export function setReplacementRecoveries(
  state: WorkspaceReplacementState,
  recoveries: ReplacementRecoverySummary[],
): WorkspaceReplacementState {
  return { ...state, recoveries: [...recoveries], recoveriesLoading: false };
}

export function matchesReplacementRequest(
  state: WorkspaceReplacementState,
  request: WorkspaceReplacementRequest,
): boolean {
  const current = state.request;
  return Boolean(
    current &&
      state.generation === request.generation &&
      current.generation === request.generation &&
      current.repositoryGeneration === request.repositoryGeneration &&
      current.repositoryRoot === request.repositoryRoot &&
      current.operationId === request.operationId &&
      current.query === request.query &&
      current.replacement === request.replacement &&
      sameWorkspaceSearchOptions(current.options, request.options),
  );
}

function cloneOptions(options: WorkspaceTextSearchOptions): WorkspaceTextSearchOptions {
  return {
    ...options,
    includeGlobs: [...options.includeGlobs],
    excludeGlobs: [...options.excludeGlobs],
  };
}
