import type { CommitSummary } from "../models";

export type RefHistorySource =
  | { kind: "all" }
  | { kind: "ref"; fullName: string };

export interface RefHistoryState {
  root: string | null;
  source: RefHistorySource | null;
  commits: CommitSummary[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  generation: number;
}

export interface RefHistoryRequest {
  root: string;
  fullName: string;
  generation: number;
}

export function emptyRefHistory(): RefHistoryState {
  return {
    root: null,
    source: null,
    commits: [],
    status: "idle",
    error: null,
    generation: 0,
  };
}

export function installAllRefHistory(
  previous: RefHistoryState,
  root: string,
  commits: CommitSummary[],
): RefHistoryState {
  return {
    root,
    source: { kind: "all" },
    commits,
    status: "ready",
    error: null,
    generation: previous.generation + 1,
  };
}

export function beginRefHistory(
  previous: RefHistoryState,
  root: string,
  fullName: string,
): { state: RefHistoryState; request: RefHistoryRequest } {
  const generation = previous.generation + 1;
  return {
    state: {
      root,
      source: { kind: "ref", fullName },
      commits: [],
      status: "loading",
      error: null,
      generation,
    },
    request: { root, fullName, generation },
  };
}

export function completeRefHistory(
  current: RefHistoryState,
  request: RefHistoryRequest,
  commits: CommitSummary[],
): RefHistoryState {
  if (!matchesRequest(current, request)) return current;
  return { ...current, commits, status: "ready", error: null };
}

export function failRefHistory(
  current: RefHistoryState,
  request: RefHistoryRequest,
  error: string,
): RefHistoryState {
  if (!matchesRequest(current, request)) return current;
  return { ...current, commits: [], status: "error", error };
}

function matchesRequest(
  current: RefHistoryState,
  request: RefHistoryRequest,
): boolean {
  return (
    current.generation === request.generation &&
    current.root === request.root &&
    current.source?.kind === "ref" &&
    current.source.fullName === request.fullName
  );
}
