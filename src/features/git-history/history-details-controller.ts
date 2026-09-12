import type {
  CommitDetails,
  CommitSummary,
  HistoryPage,
  HistoryQuery,
} from "../../models.ts";
import {
  beginHistoryQuery,
  completeRefHistory,
  emptyRefHistory,
  failRefHistory,
  installSnapshotHistory,
  type RefHistoryRequest,
  type RefHistoryState,
} from "../../workbench/ref-history.ts";
import {
  historyQueryKey,
  normalizeHistoryQuery,
} from "../../workbench/history-query.ts";
import { commitKey } from "../../workbench/history-identity.ts";
import {
  appendHistoryPage,
  matchesHistoryPageRequest,
  replaceHistoryPage,
} from "../../workbench/history-paging.ts";
import { RecentValueCache } from "../../workbench/recent-value-cache.ts";

export const HISTORY_PAGE_SIZE = 150;
export const HISTORY_SCROLL_THRESHOLD = 72;
export const COMMIT_DETAILS_CACHE_LIMIT = 48;

export type HistoryPagingRetry = "append" | "refresh" | null;

export interface GitHistoryDetailsState {
  readonly history: RefHistoryState;
  readonly query: HistoryQuery;
  readonly selectedCommit: string | null;
  readonly hasMore: boolean;
  readonly nextOffset: number;
  readonly loadingMore: boolean;
  readonly refreshing: boolean;
  readonly pagingError: string | null;
  readonly pagingRetry: HistoryPagingRetry;
  readonly details: CommitDetails | null;
  readonly detailsLoading: boolean;
  readonly detailsError: string | null;
  readonly selectedFile: string | null;
}

export interface HistoryDetailsGateway {
  readHistoryPage(
    root: string,
    query: HistoryQuery,
    offset: number,
    limit: number,
  ): Promise<HistoryPage>;
  readCommitDetails(
    root: string,
    repositoryId: string,
    oid: string,
  ): Promise<CommitDetails>;
}

export interface HistoryDetailsChange {
  readonly reason:
    | "clear"
    | "snapshot"
    | "query-start"
    | "query-complete"
    | "query-error"
    | "append-start"
    | "append-complete"
    | "append-error"
    | "refresh-start"
    | "refresh-complete"
    | "refresh-error"
    | "selection"
    | "details-start"
    | "details-complete"
    | "details-error"
    | "file-selection";
  readonly historyChanged?: boolean;
  readonly selectionChanged?: boolean;
  readonly detailsChanged?: boolean;
  readonly warning?: string;
  readonly error?: unknown;
}

export interface HistoryScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

interface GitHistoryDetailsControllerOptions {
  readonly pageSize?: number;
  readonly rowLimit: number;
  readonly scrollThreshold?: number;
  readonly detailsCacheLimit?: number;
  readonly now?: () => number;
}

type HistoryDetailsListener = (change: HistoryDetailsChange) => void;

export class GitHistoryDetailsController {
  private readonly gateway: HistoryDetailsGateway;
  private value: GitHistoryDetailsState;
  private readonly listeners = new Set<HistoryDetailsListener>();
  private readonly pageSize: number;
  private readonly rowLimit: number;
  private readonly scrollThreshold: number;
  private readonly now: () => number;
  private readonly detailsCache: RecentValueCache<CommitDetails>;
  private pageSequence = 0;
  private detailsSequence = 0;
  private topRefreshArmed = false;
  private topRefreshAt = 0;
  private disposed = false;

  constructor(gateway: HistoryDetailsGateway, options: GitHistoryDetailsControllerOptions) {
    this.gateway = gateway;
    this.pageSize = options.pageSize ?? HISTORY_PAGE_SIZE;
    this.rowLimit = options.rowLimit;
    this.scrollThreshold = options.scrollThreshold ?? HISTORY_SCROLL_THRESHOLD;
    this.now = options.now ?? Date.now;
    this.detailsCache = new RecentValueCache(
      options.detailsCacheLimit ?? COMMIT_DETAILS_CACHE_LIMIT,
    );
    const query = normalizeHistoryQuery(emptyQuery());
    this.value = {
      history: emptyRefHistory(),
      query,
      selectedCommit: null,
      hasMore: false,
      nextOffset: 0,
      loadingMore: false,
      refreshing: false,
      pagingError: null,
      pagingRetry: null,
      details: null,
      detailsLoading: false,
      detailsError: null,
      selectedFile: null,
    };
  }

  get state(): GitHistoryDetailsState {
    return this.value;
  }

  subscribe(listener: HistoryDetailsListener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(query: HistoryQuery = emptyQuery()): void {
    const selectionChanged = this.value.selectedCommit !== null;
    this.invalidateRequests();
    this.value = {
      ...this.value,
      history: emptyRefHistory(),
      query: normalizeHistoryQuery(query),
      selectedCommit: null,
      ...emptyPaging(),
      ...emptyDetails(),
    };
    this.emit({
      reason: "clear",
      historyChanged: true,
      selectionChanged,
      detailsChanged: true,
    });
  }

  installSnapshot(
    root: string,
    commits: CommitSummary[],
    query: HistoryQuery,
    preferTip = false,
  ): void {
    const previous = this.value;
    const previousSelected = previous.selectedCommit;
    const selected =
      !preferTip && previous.history.source?.kind === "snapshot"
        ? commits.some((commit) => commitKey(commit) === previousSelected)
          ? previousSelected
          : commits[0]
            ? commitKey(commits[0])
            : null
        : commits[0]
          ? commitKey(commits[0])
          : null;
    const selectionChanged =
      previous.history.root !== root ||
      previous.history.source?.kind !== "snapshot" ||
      previousSelected !== selected;
    this.pageSequence += 1;
    this.topRefreshArmed = false;
    if (selectionChanged) this.detailsSequence += 1;
    this.value = {
      ...previous,
      history: installSnapshotHistory(previous.history, root, commits),
      query: normalizeHistoryQuery(query),
      selectedCommit: selected,
      hasMore: commits.length >= this.pageSize && commits.length < this.rowLimit,
      nextOffset: commits.length,
      loadingMore: false,
      refreshing: false,
      pagingError: null,
      pagingRetry: null,
      ...(selectionChanged ? emptyDetails() : {}),
    };
    this.emit({
      reason: "snapshot",
      historyChanged: true,
      selectionChanged,
      detailsChanged: selectionChanged,
    });
  }

  loadQuery(root: string, query: HistoryQuery): void {
    const normalized = normalizeHistoryQuery(query);
    const pending = beginHistoryQuery(this.value.history, root, normalized);
    const selectionChanged = this.value.selectedCommit !== null;
    this.pageSequence += 1;
    this.detailsSequence += 1;
    this.topRefreshArmed = false;
    this.value = {
      ...this.value,
      history: pending.state,
      query: normalized,
      selectedCommit: null,
      ...emptyPaging(),
      ...emptyDetails(),
    };
    this.emit({
      reason: "query-start",
      historyChanged: true,
      selectionChanged,
      detailsChanged: true,
    });
    void this.completeInitialQuery(pending.request);
  }

  selectCommit(root: string, key: string, loadDetails: boolean): boolean {
    const commit = this.value.history.commits.find((item) => commitKey(item) === key);
    if (!commit || this.value.history.root !== root) return false;
    if (key === this.value.selectedCommit) {
      if (loadDetails) this.ensureSelectedDetails(root);
      return true;
    }
    this.detailsSequence += 1;
    this.value = {
      ...this.value,
      selectedCommit: key,
      ...emptyDetails(),
    };
    this.emit({
      reason: "selection",
      selectionChanged: true,
      detailsChanged: true,
    });
    if (loadDetails) this.ensureSelectedDetails(root);
    return true;
  }

  selectFile(path: string): boolean {
    if (!this.value.details?.files.some((file) => file.path === path)) return false;
    if (this.value.selectedFile === path) return true;
    this.value = { ...this.value, selectedFile: path };
    this.emit({ reason: "file-selection", detailsChanged: true });
    return true;
  }

  ensureSelectedDetails(root: string): void {
    if (this.value.history.root !== root) return;
    const commit = this.selectedCommitSummary();
    if (!commit) return;
    if (
      this.value.details?.oid === commit.oid &&
      this.value.details.repositoryId === commit.repositoryId
    ) {
      return;
    }
    if (this.value.detailsLoading) return;
    void this.loadSelectedDetails(root, commit);
  }

  retryDetails(root: string): void {
    const commit = this.selectedCommitSummary();
    if (!commit || this.value.history.root !== root) return;
    void this.loadSelectedDetails(root, commit);
  }

  handleScroll(metrics: HistoryScrollMetrics): void {
    if (this.value.history.status !== "ready") return;
    if (metrics.scrollTop > this.scrollThreshold) this.topRefreshArmed = true;
    const distanceFromBottom =
      metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop;
    if (distanceFromBottom <= this.scrollThreshold) void this.loadOlder();
    if (
      metrics.scrollTop <= 2 &&
      this.topRefreshArmed &&
      this.now() - this.topRefreshAt > 800
    ) {
      this.topRefreshArmed = false;
      this.topRefreshAt = this.now();
      void this.refreshLoaded();
    }
  }

  retryPaging(): void {
    if (this.value.pagingRetry === "refresh") {
      void this.refreshLoaded();
    } else if (this.value.history.status === "error") {
      const root = this.value.history.root;
      if (root) this.loadQuery(root, this.value.query);
    } else {
      void this.loadOlder();
    }
  }

  async loadOlder(): Promise<void> {
    const current = this.value;
    const root = current.history.root;
    if (
      !root ||
      current.history.status !== "ready" ||
      !current.hasMore ||
      current.loadingMore ||
      current.refreshing ||
      current.history.commits.length >= this.rowLimit ||
      current.nextOffset >= this.rowLimit
    ) {
      return;
    }
    const query = current.query;
    const queryKey = historyQueryKey(query);
    const generation = current.history.generation;
    const offset = current.nextOffset;
    const sequence = ++this.pageSequence;
    const limit = Math.min(
      this.pageSize,
      this.rowLimit - current.history.commits.length,
    );
    this.value = {
      ...current,
      loadingMore: true,
      pagingError: null,
      pagingRetry: null,
    };
    this.emit({ reason: "append-start", historyChanged: true });

    try {
      const page = await this.gateway.readHistoryPage(root, query, offset, limit);
      if (!this.pageRequestMatches(sequence, generation, root, queryKey)) return;
      if (page.offset !== offset) {
        throw new Error("History page did not match the requested offset.");
      }
      const window = appendHistoryPage(this.value.history.commits, page, this.rowLimit);
      this.value = {
        ...this.value,
        history: { ...this.value.history, commits: window.commits },
        nextOffset: window.nextOffset,
        hasMore: window.hasMore,
        loadingMore: false,
      };
      this.emit({ reason: "append-complete", historyChanged: true });
    } catch (error) {
      if (!this.pageRequestMatches(sequence, generation, root, queryKey)) return;
      this.value = {
        ...this.value,
        loadingMore: false,
        pagingError: `Older commits could not be loaded: ${errorMessage(error)}`,
        pagingRetry: "append",
      };
      this.emit({ reason: "append-error", historyChanged: true });
    }
  }

  async refreshLoaded(): Promise<void> {
    const current = this.value;
    const root = current.history.root;
    if (
      !root ||
      current.history.status !== "ready" ||
      current.loadingMore ||
      current.refreshing
    ) {
      return;
    }
    const query = current.query;
    const queryKey = historyQueryKey(query);
    const generation = current.history.generation;
    const sequence = ++this.pageSequence;
    const limit = Math.min(
      Math.max(this.pageSize, current.nextOffset),
      this.rowLimit,
    );
    const previousSelection = current.selectedCommit;
    this.value = {
      ...current,
      refreshing: true,
      pagingError: null,
      pagingRetry: null,
    };
    this.emit({ reason: "refresh-start", historyChanged: true });

    try {
      const page = await this.gateway.readHistoryPage(root, query, 0, limit);
      if (!this.pageRequestMatches(sequence, generation, root, queryKey)) return;
      if (page.offset !== 0) {
        throw new Error("Refreshed history did not begin at the requested offset.");
      }
      const window = replaceHistoryPage(page, this.rowLimit);
      const selectedCommit =
        previousSelection &&
        window.commits.some((commit) => commitKey(commit) === previousSelection)
          ? previousSelection
          : window.commits[0]
            ? commitKey(window.commits[0])
            : null;
      const selectionChanged = previousSelection !== selectedCommit;
      if (selectionChanged) this.detailsSequence += 1;
      this.value = {
        ...this.value,
        history: { ...this.value.history, commits: window.commits },
        nextOffset: window.nextOffset,
        hasMore: window.hasMore,
        refreshing: false,
        selectedCommit,
        ...(selectionChanged ? emptyDetails() : {}),
      };
      this.emit({
        reason: "refresh-complete",
        historyChanged: true,
        selectionChanged,
        detailsChanged: selectionChanged,
      });
    } catch (error) {
      if (!this.pageRequestMatches(sequence, generation, root, queryKey)) return;
      this.value = {
        ...this.value,
        refreshing: false,
        pagingError: `History could not be refreshed: ${errorMessage(error)}`,
        pagingRetry: "refresh",
      };
      this.emit({
        reason: "refresh-error",
        historyChanged: true,
        warning: "History refresh could not be completed",
      });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidateRequests();
    this.listeners.clear();
  }

  private async completeInitialQuery(request: RefHistoryRequest): Promise<void> {
    try {
      const page = await this.gateway.readHistoryPage(
        request.root,
        request.query,
        0,
        this.pageSize,
      );
      if (page.offset !== 0) {
        throw new Error("History did not begin at the requested offset.");
      }
      const history = completeRefHistory(this.value.history, request, page.commits);
      if (history === this.value.history || !this.queryRequestMatches(request)) return;
      const selectedCommit = page.commits[0] ? commitKey(page.commits[0]) : null;
      this.value = {
        ...this.value,
        history,
        hasMore: page.hasMore,
        nextOffset: page.offset + page.commits.length,
        loadingMore: false,
        refreshing: false,
        pagingError: null,
        pagingRetry: null,
        selectedCommit,
        ...emptyDetails(),
      };
      this.emit({
        reason: "query-complete",
        historyChanged: true,
        selectionChanged: selectedCommit !== null,
        detailsChanged: true,
      });
    } catch (error) {
      const history = failRefHistory(this.value.history, request, errorMessage(error));
      if (history === this.value.history || !this.queryRequestMatches(request)) return;
      this.pageSequence += 1;
      this.value = {
        ...this.value,
        history,
        selectedCommit: null,
        ...emptyPaging(),
        ...emptyDetails(),
      };
      this.emit({
        reason: "query-error",
        historyChanged: true,
        detailsChanged: true,
        warning: "Filtered history could not be loaded",
      });
    }
  }

  private async loadSelectedDetails(
    root: string,
    commit: CommitSummary,
  ): Promise<void> {
    const key = commitKey(commit);
    const cacheKey = detailsCacheKey(root, commit.repositoryId, commit.oid);
    const cached = this.detailsCache.get(cacheKey);
    const sequence = ++this.detailsSequence;
    if (cached) {
      if (!this.detailsRequestMatches(sequence, root, key, cached)) return;
      this.value = {
        ...this.value,
        details: cached,
        detailsLoading: false,
        detailsError: null,
        selectedFile: cached.files[0]?.path ?? null,
      };
      this.emit({ reason: "details-complete", detailsChanged: true });
      return;
    }
    this.value = {
      ...this.value,
      details: null,
      detailsLoading: true,
      detailsError: null,
      selectedFile: null,
    };
    this.emit({ reason: "details-start", detailsChanged: true });

    try {
      const details = await this.gateway.readCommitDetails(
        root,
        commit.repositoryId,
        commit.oid,
      );
      if (!this.detailsRequestMatches(sequence, root, key, details)) return;
      this.detailsCache.set(cacheKey, details);
      this.value = {
        ...this.value,
        details,
        detailsLoading: false,
        detailsError: null,
        selectedFile: details.files[0]?.path ?? null,
      };
      this.emit({ reason: "details-complete", detailsChanged: true });
    } catch (error) {
      if (!this.detailsRequestMatches(sequence, root, key)) return;
      this.value = {
        ...this.value,
        detailsLoading: false,
        detailsError: errorMessage(error),
      };
      this.emit({
        reason: "details-error",
        detailsChanged: true,
        error,
      });
    }
  }

  private selectedCommitSummary(): CommitSummary | null {
    const selected = this.value.selectedCommit;
    return selected
      ? this.value.history.commits.find((commit) => commitKey(commit) === selected) ?? null
      : null;
  }

  private queryRequestMatches(request: RefHistoryRequest): boolean {
    return (
      !this.disposed &&
      this.value.history.root === request.root &&
      this.value.history.generation === request.generation &&
      historyQueryKey(this.value.query) === request.key
    );
  }

  private pageRequestMatches(
    sequence: number,
    generation: number,
    root: string,
    queryKey: string,
  ): boolean {
    return matchesHistoryPageRequest(
      { sequence, generation, root, queryKey },
      {
        sequence: this.pageSequence,
        generation: this.value.history.generation,
        root: this.value.history.root ?? "",
        queryKey: historyQueryKey(this.value.query),
      },
    );
  }

  private detailsRequestMatches(
    sequence: number,
    root: string,
    key: string,
    details?: CommitDetails,
  ): boolean {
    return (
      !this.disposed &&
      sequence === this.detailsSequence &&
      this.value.history.root === root &&
      this.value.selectedCommit === key &&
      (!details || commitKey(details) === key)
    );
  }

  private invalidateRequests(): void {
    this.pageSequence += 1;
    this.detailsSequence += 1;
    this.topRefreshArmed = false;
  }

  private emit(change: HistoryDetailsChange): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener(change);
  }
}

function emptyPaging(): Pick<
  GitHistoryDetailsState,
  | "hasMore"
  | "nextOffset"
  | "loadingMore"
  | "refreshing"
  | "pagingError"
  | "pagingRetry"
> {
  return {
    hasMore: false,
    nextOffset: 0,
    loadingMore: false,
    refreshing: false,
    pagingError: null,
    pagingRetry: null,
  };
}

function emptyDetails(): Pick<
  GitHistoryDetailsState,
  "details" | "detailsLoading" | "detailsError" | "selectedFile"
> {
  return {
    details: null,
    detailsLoading: false,
    detailsError: null,
    selectedFile: null,
  };
}

function emptyQuery(): HistoryQuery {
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

function detailsCacheKey(root: string, repositoryId: string, oid: string): string {
  return `${root}\u0000${repositoryId}\u0000${oid}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
