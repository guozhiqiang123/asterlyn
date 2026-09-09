import type { CommitSummary, HistoryQuery } from "../models";
import { historyQueryKey, normalizeHistoryQuery } from "./history-query.ts";

export type RefHistorySource =
  | { kind: "snapshot" }
  | { kind: "query"; key: string; query: HistoryQuery };

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
  key: string;
  query: HistoryQuery;
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

export function installSnapshotHistory(
  previous: RefHistoryState,
  root: string,
  commits: CommitSummary[],
): RefHistoryState {
  return {
    root,
    source: { kind: "snapshot" },
    commits,
    status: "ready",
    error: null,
    generation: previous.generation + 1,
  };
}

export function beginHistoryQuery(
  previous: RefHistoryState,
  root: string,
  query: HistoryQuery,
): { state: RefHistoryState; request: RefHistoryRequest } {
  const generation = previous.generation + 1;
  const normalized = normalizeHistoryQuery(query);
  const key = historyQueryKey(normalized);
  return {
    state: {
      root,
      source: { kind: "query", key, query: normalized },
      commits: [],
      status: "loading",
      error: null,
      generation,
    },
    request: { root, key, query: normalized, generation },
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
    current.source?.kind === "query" &&
    current.source.key === request.key
  );
}
