import type {
  BranchSummary,
  HistoryCommitStart,
  HistoryPath,
  HistoryQuery,
  HistoryRef,
  ProjectFile,
  RepositorySnapshot,
} from "../../models.ts";
import {
  defaultHistoryQuery,
  normalizeHistoryQuery,
  type HistoryDatePreset,
} from "../../history-query.ts";
import { branchKey, historyPathKey, historyRefKey } from "./history-identity.ts";
import {
  loadHistoryRefPreferences,
  saveHistoryRefPreferences,
  toggleFavoriteRef,
  touchRecentRef,
} from "./history-preferences.ts";
import {
  historyPathCandidates,
  historyPathWorkspaceLabel,
  resolveHistoryPathText,
  type HistoryPathMessages,
} from "./history-path-selection.ts";
import { toggleHistoryRootSelection } from "./history-root-selection.ts";

export type HistoryFilterMenu = "branch" | "user" | "date" | "paths" | "graph";
export type HistoryFilterDialog = "branches" | "paths-text" | "paths-tree";
export type HistoryTextMode = "case" | "regex";
export type HistoryGraphOption = "first-parent" | "exclude-merges";

export type HistoryDialogApplyResult =
  | { status: "idle" }
  | { status: "error"; error: string }
  | {
      status: "applied";
      kind: HistoryFilterDialog;
      refs: ReadonlyMap<string, HistoryRef>;
      paths: ReadonlyMap<string, HistoryPath>;
    };

interface HistoryFilterState {
  historyQuery: string;
  historyCaseSensitive: boolean;
  historyRegularExpression: boolean;
  historyRefs: Map<string, HistoryRef>;
  historyStartCommit: HistoryCommitStart | null;
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
  historyFilterMenu: HistoryFilterMenu | null;
  historyBranchSubmenu: string | null;
  historyDialog: HistoryFilterDialog | null;
  historyDialogQuery: string;
  historyDialogError: string | null;
  historyRefDraft: Map<string, HistoryRef>;
  historyPathDraft: Map<string, HistoryPath>;
  historyPathText: string;
  historyTreeCollapsed: Set<string>;
}

type HistoryFilterCollectionField =
  | "historyRefs"
  | "historyAuthorEmails"
  | "historyPaths"
  | "historyRepositoryIds"
  | "historyRecentPaths"
  | "historyFavoriteRefs"
  | "historyRecentRefs"
  | "historyRefDraft"
  | "historyPathDraft"
  | "historyTreeCollapsed";

export type HistoryFilterViewState = Readonly<
  Omit<HistoryFilterState, HistoryFilterCollectionField>
> & {
  readonly historyRefs: ReadonlyMap<string, HistoryRef>;
  readonly historyAuthorEmails: ReadonlySet<string>;
  readonly historyPaths: ReadonlyMap<string, HistoryPath>;
  readonly historyRepositoryIds: ReadonlySet<string>;
  readonly historyRecentPaths: readonly HistoryPath[];
  readonly historyFavoriteRefs: ReadonlyMap<string, HistoryRef>;
  readonly historyRecentRefs: readonly HistoryRef[];
  readonly historyRefDraft: ReadonlyMap<string, HistoryRef>;
  readonly historyPathDraft: ReadonlyMap<string, HistoryPath>;
  readonly historyTreeCollapsed: ReadonlySet<string>;
};

export class HistoryFilterController {
  private readonly value = createHistoryFilterState();
  private readonly storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  get state(): HistoryFilterViewState {
    return this.value;
  }

  reset(): void {
    this.install(defaultHistoryQuery());
    this.value.historyCollapseLinear = false;
    this.closeMenus();
  }

  resetWorkspace(): void {
    this.value.historyQuery = "";
    this.value.historyRecentPaths = [];
    this.closeDialog();
    this.reset();
  }

  install(input: HistoryQuery): void {
    const query = normalizeHistoryQuery(input);
    this.value.historyRefs = keyedRefs(query.refs);
    this.value.historyStartCommit = query.startCommit;
    this.value.historyAuthorEmails = new Set(query.authorEmails);
    this.value.historyCurrentAuthor = query.currentAuthor;
    this.value.historyDatePreset = "all";
    this.value.historySinceEpoch = query.sinceEpoch;
    this.value.historyPaths = new Map(query.paths.map((path) => [historyPathKey(path), path]));
    this.value.historyRepositoryIds = new Set(query.repositoryIds);
    this.value.historyOrder = query.order;
    this.value.historyFirstParent = query.firstParent;
    this.value.historyExcludeMerges = query.excludeMerges;
  }

  reconcile(snapshot: RepositorySnapshot): void {
    const refKeys = new Set(snapshot.branches.map(branchKey));
    this.value.historyRefs = new Map(
      Array.from(this.value.historyRefs).filter(([key]) => refKeys.has(key)),
    );
    const repositoryIds = new Set(snapshot.repositoryRoots.map((root) => root.id));
    this.value.historyRepositoryIds = new Set(
      Array.from(this.value.historyRepositoryIds).filter((id) => repositoryIds.has(id)),
    );
    if (this.value.historyStartCommit &&
      !repositoryIds.has(this.value.historyStartCommit.repositoryId)) {
      this.value.historyStartCommit = null;
    }
    this.value.historyPaths = new Map(
      Array.from(this.value.historyPaths).filter(([, path]) =>
        repositoryIds.has(path.repositoryId)),
    );
  }

  loadPreferences(snapshot: RepositorySnapshot): void {
    const preferences = loadHistoryRefPreferences(
      this.storage,
      snapshot.root,
      snapshot.branches.map(historyReference),
    );
    this.value.historyFavoriteRefs = keyedRefs(preferences.favoriteRefs);
    this.value.historyRecentRefs = preferences.recentRefs;
  }

  recordRecentRef(repositoryRoot: string, reference: HistoryRef): void {
    const preferences = touchRecentRef(this.preferences(), reference);
    this.value.historyRecentRefs = preferences.recentRefs;
    this.persist(repositoryRoot);
  }

  toggleFavorite(repositoryRoot: string, branch: BranchSummary): void {
    const preferences = toggleFavoriteRef(this.preferences(), historyReference(branch));
    this.value.historyFavoriteRefs = keyedRefs(preferences.favoriteRefs);
    this.persist(repositoryRoot);
  }

  recordRecentPath(path: HistoryPath): void {
    const key = historyPathKey(path);
    this.value.historyRecentPaths = [
      path,
      ...this.value.historyRecentPaths.filter((item) => historyPathKey(item) !== key),
    ].slice(0, 8);
  }

  setTextQuery(query: string): void {
    this.value.historyQuery = query;
  }

  clearTextQuery(): void {
    this.value.historyQuery = "";
  }

  toggleTextMode(mode: HistoryTextMode): void {
    if (mode === "case") {
      this.value.historyCaseSensitive = !this.value.historyCaseSensitive;
    } else {
      this.value.historyRegularExpression = !this.value.historyRegularExpression;
    }
  }

  toggleMenu(menu: HistoryFilterMenu): void {
    this.value.historyFilterMenu = this.value.historyFilterMenu === menu ? null : menu;
    this.value.historyBranchSubmenu = null;
  }

  openBranchSubmenu(submenu: string): boolean {
    if (this.value.historyBranchSubmenu === submenu) return false;
    this.value.historyBranchSubmenu = submenu;
    return true;
  }

  closeMenus(): void {
    this.value.historyFilterMenu = null;
    this.value.historyBranchSubmenu = null;
  }

  installRefs(refs: readonly HistoryRef[]): void {
    this.value.historyStartCommit = null;
    this.value.historyRefs = keyedRefs([...refs]);
  }

  clearRefs(): void {
    this.value.historyStartCommit = null;
    this.value.historyRefs.clear();
  }

  clearAuthors(): void {
    this.value.historyStartCommit = null;
    this.value.historyCurrentAuthor = false;
    this.value.historyAuthorEmails.clear();
  }

  toggleCurrentAuthor(): void {
    this.value.historyStartCommit = null;
    this.value.historyCurrentAuthor = !this.value.historyCurrentAuthor;
  }

  toggleAuthor(email: string): void {
    this.value.historyStartCommit = null;
    const authors = new Set(this.value.historyAuthorEmails);
    if (authors.has(email)) authors.delete(email);
    else authors.add(email);
    this.value.historyAuthorEmails = authors;
  }

  setDatePreset(preset: HistoryDatePreset, sinceEpoch: number | null): void {
    this.value.historyStartCommit = null;
    this.value.historyDatePreset = preset;
    this.value.historySinceEpoch = sinceEpoch;
  }

  setOrder(order: HistoryQuery["order"]): void {
    this.value.historyStartCommit = null;
    this.value.historyOrder = order;
  }

  toggleRepositoryRoot(
    allRepositoryIds: readonly string[],
    repositoryId: string,
    selected: boolean,
  ): void {
    this.value.historyStartCommit = null;
    this.value.historyRepositoryIds = toggleHistoryRootSelection(
      allRepositoryIds,
      this.value.historyRepositoryIds,
      repositoryId,
      selected,
    );
  }

  selectPath(key: string, path: HistoryPath): void {
    this.value.historyStartCommit = null;
    this.value.historyPaths = new Map([[key, path]]);
    this.recordRecentPath(path);
    this.closeMenus();
  }

  toggleGraphOption(option: HistoryGraphOption): void {
    this.value.historyStartCommit = null;
    if (option === "first-parent") {
      this.value.historyFirstParent = !this.value.historyFirstParent;
    } else {
      this.value.historyExcludeMerges = !this.value.historyExcludeMerges;
    }
  }

  toggleCollapseLinear(): void {
    this.value.historyCollapseLinear = !this.value.historyCollapseLinear;
  }

  expandLinearHistory(): void {
    this.value.historyCollapseLinear = false;
  }

  openDialog(kind: HistoryFilterDialog, files: ProjectFile[]): void {
    this.value.historyDialog = kind;
    this.value.historyDialogQuery = "";
    this.value.historyDialogError = null;
    this.closeMenus();
    if (kind === "branches") {
      this.value.historyRefDraft = new Map(this.value.historyRefs);
      return;
    }
    this.value.historyPathDraft = new Map(this.value.historyPaths);
    this.value.historyPathText = Array.from(this.value.historyPaths.values())
      .map((path) => historyPathWorkspaceLabel(path, files))
      .join("\n");
  }

  closeDialog(): void {
    this.value.historyDialog = null;
    this.value.historyDialogError = null;
  }

  setDialogQuery(query: string): void {
    this.value.historyDialogQuery = query;
  }

  setRefDraft(key: string, reference: HistoryRef, selected: boolean): void {
    if (selected) this.value.historyRefDraft.set(key, reference);
    else this.value.historyRefDraft.delete(key);
  }

  setPathDraft(key: string, candidate: HistoryPath, selected: boolean): void {
    if (!selected) {
      this.value.historyPathDraft.delete(key);
      return;
    }
    for (const [selectedKey, current] of this.value.historyPathDraft) {
      if (
        current.repositoryId === candidate.repositoryId &&
        (current.path.startsWith(`${candidate.path}/`) ||
          candidate.path.startsWith(`${current.path}/`))
      ) {
        this.value.historyPathDraft.delete(selectedKey);
      }
    }
    this.value.historyPathDraft.set(key, {
      repositoryId: candidate.repositoryId,
      path: candidate.path,
    });
  }

  toggleTreePath(key: string): void {
    if (this.value.historyTreeCollapsed.has(key)) this.value.historyTreeCollapsed.delete(key);
    else this.value.historyTreeCollapsed.add(key);
  }

  setPathText(text: string): void {
    this.value.historyPathText = text;
    this.value.historyDialogError = null;
  }

  clearDialogDraft(): void {
    if (this.value.historyDialog === "branches") this.value.historyRefDraft.clear();
    else this.value.historyPathDraft.clear();
  }

  applyDialog(files: ProjectFile[], messages: HistoryPathMessages): HistoryDialogApplyResult {
    const kind = this.value.historyDialog;
    if (!kind) return { status: "idle" };
    this.value.historyStartCommit = null;
    if (kind === "branches") {
      this.value.historyRefs = new Map(this.value.historyRefDraft);
    } else if (kind === "paths-text") {
      const result = resolveHistoryPathText(
        this.value.historyPathText,
        historyPathCandidates(files),
        messages,
      );
      if (result.error) {
        this.value.historyDialogError = result.error;
        return { status: "error", error: result.error };
      }
      this.value.historyPathDraft = new Map(
        result.paths.map((path) => [historyPathKey(path), path]),
      );
      this.value.historyPaths = new Map(this.value.historyPathDraft);
    } else {
      this.value.historyPaths = new Map(this.value.historyPathDraft);
    }
    const result: HistoryDialogApplyResult = {
      status: "applied",
      kind,
      refs: new Map(this.value.historyRefs),
      paths: new Map(this.value.historyPaths),
    };
    this.closeDialog();
    return result;
  }

  query(): HistoryQuery {
    return normalizeHistoryQuery({
      repositoryIds: Array.from(this.value.historyRepositoryIds),
      refs: Array.from(this.value.historyRefs.values()),
      startCommit: this.value.historyStartCommit,
      authorEmails: Array.from(this.value.historyAuthorEmails),
      currentAuthor: this.value.historyCurrentAuthor,
      sinceEpoch: this.value.historySinceEpoch,
      paths: Array.from(this.value.historyPaths.values()),
      firstParent: this.value.historyFirstParent,
      excludeMerges: this.value.historyExcludeMerges,
      order: this.value.historyOrder,
    });
  }

  private preferences(): { favoriteRefs: HistoryRef[]; recentRefs: HistoryRef[] } {
    return {
      favoriteRefs: Array.from(this.value.historyFavoriteRefs.values()),
      recentRefs: [...this.value.historyRecentRefs],
    };
  }

  private persist(repositoryRoot: string): void {
    saveHistoryRefPreferences(this.storage, repositoryRoot, this.preferences());
  }
}

function createHistoryFilterState(): HistoryFilterState {
  const query = defaultHistoryQuery();
  return {
    historyQuery: "",
    historyCaseSensitive: false,
    historyRegularExpression: false,
    historyRefs: keyedRefs(query.refs),
    historyStartCommit: query.startCommit,
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
    historyFilterMenu: null,
    historyBranchSubmenu: null,
    historyDialog: null,
    historyDialogQuery: "",
    historyDialogError: null,
    historyRefDraft: new Map(),
    historyPathDraft: new Map(),
    historyPathText: "",
    historyTreeCollapsed: new Set(),
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
