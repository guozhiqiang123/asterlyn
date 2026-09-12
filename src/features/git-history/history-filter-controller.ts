import type { BranchSummary, HistoryPath, HistoryQuery, HistoryRef, RepositorySnapshot } from "../../models.ts";
import {
  defaultHistoryQuery,
  normalizeHistoryQuery,
  type HistoryDatePreset,
} from "../../workbench/history-query.ts";
import { branchKey, historyPathKey, historyRefKey } from "../../workbench/history-identity.ts";
import {
  loadHistoryRefPreferences,
  saveHistoryRefPreferences,
  toggleFavoriteRef,
  touchRecentRef,
} from "../../workbench/history-preferences.ts";

export interface HistoryFilterState {
  historyRefs: Map<string, HistoryRef>;
  historyAuthorEmails: Set<string>;
  historyCurrentAuthor: boolean;
  historyDatePreset: HistoryDatePreset;
  historySinceEpoch: number | null;
  historyPaths: Map<string, HistoryPath>;
  historyRepositoryIds: Set<string>;
  historyRecentPaths: HistoryPath[];
  historyOrder: HistoryQuery["order"];
  historyFirstParent: boolean;
  historyExcludeMerges: boolean;
  historyCollapseLinear: boolean;
  historyFavoriteRefs: Map<string, HistoryRef>;
  historyRecentRefs: HistoryRef[];
}

export class HistoryFilterController {
  readonly state: HistoryFilterState;
  private readonly storage: Storage;

  constructor(
    state: HistoryFilterState,
    storage: Storage,
  ) {
    this.state = state;
    this.storage = storage;
  }

  reset(): void {
    const query = defaultHistoryQuery();
    this.state.historyRefs = keyedRefs(query.refs);
    this.state.historyAuthorEmails = new Set(query.authorEmails);
    this.state.historyCurrentAuthor = query.currentAuthor;
    this.state.historyDatePreset = "all";
    this.state.historySinceEpoch = query.sinceEpoch;
    this.state.historyPaths = new Map(query.paths.map((path) => [historyPathKey(path), path]));
    this.state.historyRepositoryIds = new Set(query.repositoryIds);
    this.state.historyOrder = query.order;
    this.state.historyFirstParent = query.firstParent;
    this.state.historyExcludeMerges = query.excludeMerges;
    this.state.historyCollapseLinear = false;
  }

  reconcile(snapshot: RepositorySnapshot): void {
    const refKeys = new Set(snapshot.branches.map(branchKey));
    this.state.historyRefs = new Map(
      Array.from(this.state.historyRefs).filter(([key]) => refKeys.has(key)),
    );
    const repositoryIds = new Set(snapshot.repositoryRoots.map((root) => root.id));
    this.state.historyRepositoryIds = new Set(
      Array.from(this.state.historyRepositoryIds).filter((id) => repositoryIds.has(id)),
    );
    this.state.historyPaths = new Map(
      Array.from(this.state.historyPaths).filter(([, path]) =>
        repositoryIds.has(path.repositoryId)),
    );
  }

  loadPreferences(snapshot: RepositorySnapshot): void {
    const preferences = loadHistoryRefPreferences(
      this.storage,
      snapshot.root,
      snapshot.branches.map(historyReference),
    );
    this.state.historyFavoriteRefs = keyedRefs(preferences.favoriteRefs);
    this.state.historyRecentRefs = preferences.recentRefs;
  }

  recordRecentRef(repositoryRoot: string, reference: HistoryRef): void {
    const preferences = touchRecentRef(this.preferences(), reference);
    this.state.historyRecentRefs = preferences.recentRefs;
    this.persist(repositoryRoot);
  }

  toggleFavorite(repositoryRoot: string, branch: BranchSummary): void {
    const preferences = toggleFavoriteRef(this.preferences(), historyReference(branch));
    this.state.historyFavoriteRefs = keyedRefs(preferences.favoriteRefs);
    this.persist(repositoryRoot);
  }

  recordRecentPath(path: HistoryPath): void {
    const key = historyPathKey(path);
    this.state.historyRecentPaths = [
      path,
      ...this.state.historyRecentPaths.filter((item) => historyPathKey(item) !== key),
    ].slice(0, 8);
  }

  query(): HistoryQuery {
    return normalizeHistoryQuery({
      repositoryIds: Array.from(this.state.historyRepositoryIds),
      refs: Array.from(this.state.historyRefs.values()),
      authorEmails: Array.from(this.state.historyAuthorEmails),
      currentAuthor: this.state.historyCurrentAuthor,
      sinceEpoch: this.state.historySinceEpoch,
      paths: Array.from(this.state.historyPaths.values()),
      firstParent: this.state.historyFirstParent,
      excludeMerges: this.state.historyExcludeMerges,
      order: this.state.historyOrder,
    });
  }

  private preferences(): { favoriteRefs: HistoryRef[]; recentRefs: HistoryRef[] } {
    return {
      favoriteRefs: Array.from(this.state.historyFavoriteRefs.values()),
      recentRefs: [...this.state.historyRecentRefs],
    };
  }

  private persist(repositoryRoot: string): void {
    saveHistoryRefPreferences(this.storage, repositoryRoot, this.preferences());
  }
}

export function createHistoryFilterState(): HistoryFilterState {
  const query = defaultHistoryQuery();
  return {
    historyRefs: keyedRefs(query.refs),
    historyAuthorEmails: new Set(query.authorEmails),
    historyCurrentAuthor: query.currentAuthor,
    historyDatePreset: "all",
    historySinceEpoch: query.sinceEpoch,
    historyPaths: new Map(query.paths.map((path) => [historyPathKey(path), path])),
    historyRepositoryIds: new Set(query.repositoryIds),
    historyRecentPaths: [],
    historyOrder: query.order,
    historyFirstParent: query.firstParent,
    historyExcludeMerges: query.excludeMerges,
    historyCollapseLinear: false,
    historyFavoriteRefs: new Map(),
    historyRecentRefs: [],
  };
}

function keyedRefs(refs: HistoryRef[]): Map<string, HistoryRef> {
  return new Map(refs.map((reference) => [historyRefKey(reference), reference]));
}

function historyReference(branch: BranchSummary): HistoryRef {
  return {
    repositoryId: branch.repositoryId,
    fullName: branch.fullName,
  };
}
