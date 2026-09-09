import type { CommitSummary, HistoryQuery } from "../models";

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
    refs: [],
    authorEmails: [],
    currentAuthor: false,
    sinceEpoch: null,
    path: null,
    firstParent: false,
    excludeMerges: false,
    order: "topological",
  };
}

export function normalizeHistoryQuery(query: HistoryQuery): HistoryQuery {
  return {
    refs: normalizedValues(query.refs),
    authorEmails: normalizedValues(query.authorEmails),
    currentAuthor: query.currentAuthor,
    sinceEpoch:
      query.sinceEpoch !== null && Number.isSafeInteger(query.sinceEpoch) && query.sinceEpoch > 0
        ? query.sinceEpoch
        : null,
    path: query.path?.trim() || null,
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
    normalized.authorEmails.length === 0 &&
    !normalized.currentAuthor &&
    normalized.sinceEpoch === null &&
    normalized.path === null &&
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
