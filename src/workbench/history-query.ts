import type { CommitSummary, HistoryPath, HistoryQuery, HistoryRef } from "../models";
import { historyPathKey, historyRefKey } from "./history-identity.ts";

export type HistoryDatePreset = "all" | "day" | "week";

export interface HistoryAuthorChoice {
  email: string;
  name: string;
  count: number;
}

export interface HistoryTextResult {
  commits: CommitSummary[];
  error: string | null;
}

export function defaultHistoryQuery(): HistoryQuery {
  return {
    repositoryIds: [],
    refs: [],
    authorEmails: [],
    currentAuthor: false,
    sinceEpoch: null,
    paths: [],
    firstParent: false,
    excludeMerges: false,
    order: "topological",
  };
}

export function normalizeHistoryQuery(query: HistoryQuery): HistoryQuery {
  return {
    repositoryIds: normalizedValues(query.repositoryIds),
    refs: normalizedSelections(
      query.refs
        .map((reference) => ({
          repositoryId: reference.repositoryId.trim(),
          fullName: reference.fullName.trim(),
        }))
        .filter((reference) => reference.repositoryId && reference.fullName),
      historyRefKey,
    ),
    authorEmails: normalizedValues(query.authorEmails),
    currentAuthor: query.currentAuthor,
    sinceEpoch:
      query.sinceEpoch !== null && Number.isSafeInteger(query.sinceEpoch) && query.sinceEpoch > 0
        ? query.sinceEpoch
        : null,
    paths: normalizedSelections(
      query.paths
        .map((path) => ({
          repositoryId: path.repositoryId.trim(),
          path: path.path.trim(),
        }))
        .filter((path) => path.repositoryId && path.path),
      historyPathKey,
    ),
    firstParent: query.firstParent,
    excludeMerges: query.excludeMerges,
    order: query.order === "date" ? "date" : "topological",
  };
}

export function historyQueryKey(query: HistoryQuery): string {
  return JSON.stringify(normalizeHistoryQuery(query));
}

export function isSnapshotHistoryQuery(query: HistoryQuery): boolean {
  const normalized = normalizeHistoryQuery(query);
  return (
    normalized.refs.length === 0 &&
    normalized.repositoryIds.length === 0 &&
    normalized.authorEmails.length === 0 &&
    !normalized.currentAuthor &&
    normalized.sinceEpoch === null &&
    normalized.paths.length === 0 &&
    !normalized.firstParent &&
    !normalized.excludeMerges &&
    normalized.order === "topological"
  );
}

export function historyDateSince(
  preset: HistoryDatePreset,
  nowMilliseconds = Date.now(),
): number | null {
  const seconds = preset === "day" ? 24 * 60 * 60 : preset === "week" ? 7 * 24 * 60 * 60 : 0;
  return seconds === 0 ? null : Math.floor(nowMilliseconds / 1000) - seconds;
}

export function historyAuthorChoices(
  commits: Pick<CommitSummary, "authorEmail" | "authorName">[],
): HistoryAuthorChoice[] {
  const choices = new Map<string, HistoryAuthorChoice>();
  for (const commit of commits) {
    const email = commit.authorEmail.trim();
    if (!email) continue;
    const existing = choices.get(email);
    if (existing) {
      existing.count += 1;
    } else {
      choices.set(email, {
        email,
        name: commit.authorName.trim() || email,
        count: 1,
      });
    }
  }
  return Array.from(choices.values()).sort(
    (left, right) => right.count - left.count || left.name.localeCompare(right.name),
  );
}

export function filterHistoryText(
  commits: CommitSummary[],
  query: string,
  options: { caseSensitive: boolean; regularExpression: boolean },
): HistoryTextResult {
  const needle = query.trim();
  if (!needle) return { commits, error: null };
  const values = (commit: CommitSummary): string[] => [
    commit.oid,
    commit.shortOid,
    commit.subject,
    commit.authorName,
    commit.authorEmail,
    ...commit.decorations,
  ];

  if (options.regularExpression) {
    let expression: RegExp;
    try {
      expression = new RegExp(needle, options.caseSensitive ? "u" : "iu");
    } catch (error) {
      return {
        commits,
        error: error instanceof Error ? error.message : "Invalid regular expression",
      };
    }
    return {
      commits: commits.filter((commit) => values(commit).some((value) => expression.test(value))),
      error: null,
    };
  }

  const expected = options.caseSensitive ? needle : needle.toLocaleLowerCase();
  return {
    commits: commits.filter((commit) =>
      values(commit).some((value) =>
        (options.caseSensitive ? value : value.toLocaleLowerCase()).includes(expected),
      ),
    ),
    error: null,
  };
}

function normalizedValues(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

function normalizedSelections<T extends HistoryRef | HistoryPath>(
  values: T[],
  key: (value: T) => string,
): T[] {
  const unique = new Map<string, T>();
  for (const value of values) unique.set(key(value), value);
  return Array.from(unique.values()).sort((left, right) => key(left).localeCompare(key(right)));
}
