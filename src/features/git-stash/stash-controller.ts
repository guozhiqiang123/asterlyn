import type {
  CommitDetails,
  CommitDiffResult,
  CommitFileChange,
  StashCatalog,
  StashEntry,
} from "../../models.ts";
import type { CommitFileView } from "../../presentation/git-presentation.ts";

export interface StashGateway {
  readStashCatalog(repositoryRoot: string): Promise<StashCatalog>;
  readStashDetails(
    repositoryRoot: string,
    repositoryId: string,
    stashOid: string,
  ): Promise<CommitDetails>;
  readStashDiff(
    repositoryRoot: string,
    repositoryId: string,
    stashOid: string,
    path: string,
    originalPath: string | null,
    expandedUnchanged?: boolean,
  ): Promise<CommitDiffResult>;
}

export interface StashState {
  root: string | null;
  entries: StashEntry[];
  truncatedRepositoryIds: string[];
  selectedKey: string | null;
  selectedFile: string | null;
  loading: boolean;
  error: string | null;
  details: CommitDetails | null;
  detailsLoading: boolean;
  detailsError: string | null;
  patch: CommitDiffResult | null;
  patchLoading: boolean;
  patchError: string | null;
  patchVersion: number;
  version: number;
  fileView: CommitFileView;
  collapsedDirectories: Set<string>;
}

type Listener = () => void;

export class StashController {
  readonly state: StashState = {
    root: null,
    entries: [],
    truncatedRepositoryIds: [],
    selectedKey: null,
    selectedFile: null,
    loading: false,
    error: null,
    details: null,
    detailsLoading: false,
    detailsError: null,
    patch: null,
    patchLoading: false,
    patchError: null,
    patchVersion: 0,
    version: 0,
    fileView: "tree",
    collapsedDirectories: new Set(),
  };

  private readonly listeners = new Set<Listener>();
  private catalogRequest = 0;
  private detailsRequest = 0;
  private patchRequest = 0;
  private readonly gateway: StashGateway;

  constructor(gateway: StashGateway) { this.gateway = gateway; }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.catalogRequest += 1;
    this.detailsRequest += 1;
    this.patchRequest += 1;
    Object.assign(this.state, {
      root: null, entries: [], truncatedRepositoryIds: [], selectedKey: null,
      selectedFile: null, loading: false, error: null, details: null,
      detailsLoading: false, detailsError: null, patch: null,
      patchLoading: false, patchError: null,
      collapsedDirectories: new Set(),
      version: this.state.version + 1,
      patchVersion: this.state.patchVersion + 1,
    });
    this.emit();
  }

  async load(root: string, preserveSelection = true): Promise<void> {
    const request = ++this.catalogRequest;
    const previousKey = preserveSelection ? this.state.selectedKey : null;
    this.state.root = root;
    this.state.loading = true;
    this.state.error = null;
    this.emit();
    try {
      const catalog = await this.gateway.readStashCatalog(root);
      if (request !== this.catalogRequest || this.state.root !== root) return;
      this.state.entries = catalog.entries;
      this.state.truncatedRepositoryIds = catalog.truncatedRepositoryIds;
      this.state.loading = false;
      this.state.version += 1;
      const selected = catalog.entries.find((entry) => stashKey(entry) === previousKey) ?? catalog.entries[0] ?? null;
      this.installSelection(selected);
      this.emit();
      if (selected) await this.loadDetails(root, selected);
    } catch (error) {
      if (request !== this.catalogRequest || this.state.root !== root) return;
      this.state.loading = false;
      this.state.error = errorMessage(error);
      this.state.entries = [];
      this.installSelection(null);
      this.emit();
    }
  }

  select(entry: StashEntry): void {
    const root = this.state.root;
    if (!root || !this.isCurrent(entry)) return;
    if (this.state.selectedKey === stashKey(entry) && this.state.details) return;
    this.installSelection(entry);
    this.emit();
    void this.loadDetails(root, entry);
  }

  async ensureSelectedDetails(entry: StashEntry): Promise<CommitDetails | null> {
    const root = this.state.root;
    if (!root || !this.isCurrent(entry)) return null;
    if (this.state.selectedKey !== stashKey(entry)) {
      this.installSelection(entry);
      this.emit();
    }
    if (this.state.details?.repositoryId === entry.repositoryId && this.state.details.oid === entry.oid) {
      return this.state.details;
    }
    await this.loadDetails(root, entry);
    return this.state.selectedKey === stashKey(entry) ? this.state.details : null;
  }

  selectFile(path: string): CommitFileChange | null {
    const file = this.state.details?.files.find((candidate) => candidate.path === path) ?? null;
    if (!file) return null;
    this.patchRequest += 1;
    this.state.selectedFile = path;
    this.state.patch = null;
    this.state.patchLoading = false;
    this.state.patchError = null;
    this.state.patchVersion += 1;
    this.emit();
    return file;
  }

  toggleFileView(): CommitFileView {
    this.state.fileView = this.state.fileView === "tree" ? "flat" : "tree";
    this.emit();
    return this.state.fileView;
  }

  setDirectoryExpanded(path: string, expanded: boolean): void {
    if (expanded) this.state.collapsedDirectories.delete(path);
    else this.state.collapsedDirectories.add(path);
    this.emit();
  }

  expandDirectories(): void {
    this.state.collapsedDirectories.clear();
    this.emit();
  }

  collapseDirectories(paths: Iterable<string>): void {
    this.state.collapsedDirectories = new Set(paths);
    this.emit();
  }

  async loadSelectedDiff(expandedUnchanged = false): Promise<CommitDiffResult | null> {
    const root = this.state.root;
    const entry = this.selectedEntry();
    const file = this.selectedFile();
    if (!root || !entry || !file) return null;
    const request = ++this.patchRequest;
    this.state.patchLoading = true;
    this.state.patchError = null;
    this.state.patch = null;
    this.state.patchVersion += 1;
    this.emit();
    try {
      const patch = await this.gateway.readStashDiff(
        root, entry.repositoryId, entry.oid, file.path, file.originalPath, expandedUnchanged,
      );
      if (!this.patchIsCurrent(request, root, entry, file.path)) return null;
      this.state.patch = patch;
      this.state.patchLoading = false;
      this.state.patchVersion += 1;
      this.emit();
      return patch;
    } catch (error) {
      if (!this.patchIsCurrent(request, root, entry, file.path)) return null;
      this.state.patchLoading = false;
      this.state.patchError = errorMessage(error);
      this.state.patchVersion += 1;
      this.emit();
      return null;
    }
  }

  selectedEntry(): StashEntry | null {
    return this.state.entries.find((entry) => stashKey(entry) === this.state.selectedKey) ?? null;
  }

  selectedFile(): CommitFileChange | null {
    return this.state.details?.files.find((file) => file.path === this.state.selectedFile) ?? null;
  }

  isCurrent(entry: StashEntry): boolean {
    const current = this.state.entries.find((candidate) => stashKey(candidate) === stashKey(entry));
    return Boolean(current && current.reference === entry.reference && current.subject === entry.subject);
  }

  private async loadDetails(root: string, entry: StashEntry): Promise<void> {
    const request = ++this.detailsRequest;
    this.state.detailsLoading = true;
    this.state.detailsError = null;
    this.emit();
    try {
      const details = await this.gateway.readStashDetails(root, entry.repositoryId, entry.oid);
      if (request !== this.detailsRequest || this.state.root !== root || this.state.selectedKey !== stashKey(entry)) return;
      this.state.details = details;
      this.state.detailsLoading = false;
      this.state.selectedFile = details.files[0]?.path ?? null;
      this.emit();
    } catch (error) {
      if (request !== this.detailsRequest || this.state.root !== root || this.state.selectedKey !== stashKey(entry)) return;
      this.state.detailsLoading = false;
      this.state.detailsError = errorMessage(error);
      this.emit();
    }
  }

  private installSelection(entry: StashEntry | null): void {
    this.detailsRequest += 1;
    this.patchRequest += 1;
    this.state.selectedKey = entry ? stashKey(entry) : null;
    this.state.selectedFile = null;
    this.state.collapsedDirectories.clear();
    this.state.details = null;
    this.state.detailsLoading = false;
    this.state.detailsError = null;
    this.state.patch = null;
    this.state.patchLoading = false;
    this.state.patchError = null;
    this.state.patchVersion += 1;
  }

  private patchIsCurrent(request: number, root: string, entry: StashEntry, path: string): boolean {
    return request === this.patchRequest && this.state.root === root &&
      this.state.selectedKey === stashKey(entry) && this.state.selectedFile === path;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export function stashKey(entry: Pick<StashEntry, "repositoryId" | "oid">): string {
  return `${entry.repositoryId}\0${entry.oid}`;
}

export function stashDomKey(entry: Pick<StashEntry, "repositoryId" | "oid">): string {
  return `${encodeURIComponent(entry.repositoryId)}:${entry.oid}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
