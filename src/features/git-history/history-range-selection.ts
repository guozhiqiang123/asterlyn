import type { CommitSummary } from "../../models.ts";

export const HISTORY_RANGE_LIMIT = 100;

export type HistorySelectionEntry =
  | { readonly kind: "commit"; readonly key: string; readonly commit: CommitSummary }
  | { readonly kind: "barrier"; readonly id: string };

export interface HistoryRangeSelection {
  readonly scopeKey: string;
  readonly anchorKey: string;
  readonly activeKey: string;
  readonly commits: readonly CommitSummary[];
}

export type HistoryRangeSelectionLimit = "barrier" | "limit" | null;

export interface HistoryRangeSelectionResult {
  readonly selection: HistoryRangeSelection | null;
  readonly limitedBy: HistoryRangeSelectionLimit;
}

/** Owns History's logical selection independently of mounted virtual-list rows. */
export class HistoryRangeSelectionController {
  private scopeKey = "";
  private entries: readonly HistorySelectionEntry[] = [];
  private value: HistoryRangeSelection | null = null;

  get selection(): HistoryRangeSelection | null {
    return this.value;
  }

  reconcile(scopeKey: string, entries: readonly HistorySelectionEntry[]): HistoryRangeSelection | null {
    if (scopeKey !== this.scopeKey) {
      this.scopeKey = scopeKey;
      this.entries = cloneEntries(entries);
      this.value = null;
      return null;
    }
    this.entries = cloneEntries(entries);
    if (!this.value) return null;
    const rebuilt = rangeBetween(this.entries, this.value.anchorKey, this.value.activeKey);
    if (!rebuilt || rebuilt.commits.length !== this.value.commits.length) {
      this.value = null;
      return null;
    }
    const expected = this.value.commits.map(commitIdentity);
    if (rebuilt.commits.some((commit, index) => commitIdentity(commit) !== expected[index])) {
      this.value = null;
      return null;
    }
    this.value = { ...rebuilt, scopeKey: this.scopeKey };
    return this.value;
  }

  select(key: string, extend: boolean): HistoryRangeSelectionResult {
    const selected = entryForKey(this.entries, key);
    if (!selected) return { selection: this.value, limitedBy: null };
    if (!extend || !this.value) {
      this.value = selection(this.scopeKey, key, key, [selected.commit]);
      return { selection: this.value, limitedBy: null };
    }
    const bounded = boundedRange(this.entries, this.value.anchorKey, key);
    if (!bounded) {
      this.value = selection(this.scopeKey, key, key, [selected.commit]);
      return { selection: this.value, limitedBy: null };
    }
    this.value = selection(
      this.scopeKey,
      this.value.anchorKey,
      bounded.activeKey,
      bounded.commits,
    );
    return { selection: this.value, limitedBy: bounded.limitedBy };
  }

  contextTarget(key: string): HistoryRangeSelection | null {
    if (this.value?.commits.length && this.value.commits.some((commit) => commitIdentity(commit) === key)) {
      return this.value;
    }
    return this.select(key, false).selection;
  }

  clear(): void {
    this.value = null;
  }
}

function boundedRange(
  entries: readonly HistorySelectionEntry[],
  anchorKey: string,
  requestedKey: string,
): { commits: CommitSummary[]; activeKey: string; limitedBy: HistoryRangeSelectionLimit } | null {
  const anchor = entries.findIndex((entry) => entry.kind === "commit" && entry.key === anchorKey);
  const requested = entries.findIndex((entry) => entry.kind === "commit" && entry.key === requestedKey);
  if (anchor < 0 || requested < 0) return null;
  const direction = requested >= anchor ? 1 : -1;
  const commits: CommitSummary[] = [];
  let activeKey = anchorKey;
  let limitedBy: HistoryRangeSelectionLimit = null;
  for (let index = anchor; ; index += direction) {
    const entry = entries[index];
    if (!entry || entry.kind === "barrier") {
      limitedBy = "barrier";
      break;
    }
    commits.push(cloneCommit(entry.commit));
    activeKey = entry.key;
    if (commits.length === HISTORY_RANGE_LIMIT && index !== requested) {
      limitedBy = "limit";
      break;
    }
    if (index === requested) break;
  }
  commits.sort((left, right) => entryIndex(entries, left) - entryIndex(entries, right));
  return { commits, activeKey, limitedBy };
}

function rangeBetween(
  entries: readonly HistorySelectionEntry[],
  anchorKey: string,
  activeKey: string,
): { anchorKey: string; activeKey: string; commits: CommitSummary[] } | null {
  const bounded = boundedRange(entries, anchorKey, activeKey);
  return bounded && !bounded.limitedBy
    ? { anchorKey, activeKey, commits: bounded.commits }
    : null;
}

function entryForKey(
  entries: readonly HistorySelectionEntry[],
  key: string,
): Extract<HistorySelectionEntry, { kind: "commit" }> | null {
  for (const entry of entries) {
    if (entry.kind === "commit" && entry.key === key) return entry;
  }
  return null;
}

function entryIndex(entries: readonly HistorySelectionEntry[], commit: CommitSummary): number {
  const key = commitIdentity(commit);
  return entries.findIndex((entry) => entry.kind === "commit" && entry.key === key);
}

function selection(
  scopeKey: string,
  anchorKey: string,
  activeKey: string,
  commits: readonly CommitSummary[],
): HistoryRangeSelection {
  return { scopeKey, anchorKey, activeKey, commits: commits.map(cloneCommit) };
}

function cloneEntries(entries: readonly HistorySelectionEntry[]): HistorySelectionEntry[] {
  return entries.map((entry) => entry.kind === "barrier"
    ? { ...entry }
    : { ...entry, commit: cloneCommit(entry.commit) });
}

function cloneCommit(commit: CommitSummary): CommitSummary {
  return { ...commit, parents: [...commit.parents], decorations: [...commit.decorations] };
}

function commitIdentity(commit: CommitSummary): string {
  return `${encodeURIComponent(commit.repositoryId)}:${commit.oid}`;
}
