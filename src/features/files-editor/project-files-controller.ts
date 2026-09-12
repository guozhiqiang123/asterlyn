import type {
  FileChange,
  ProjectFile,
  ProjectFileList,
  ProjectIgnoredEntry,
} from "../../models.ts";
import {
  ancestorProjectDirectories,
  buildProjectTree,
  defaultExpandedProjectDirectories,
  descendantProjectDirectories,
  findProjectTreeNode,
  projectTreeEntries,
  reconcileProjectTreeState,
  type ProjectTreeNode,
  type ProjectTreeSelection,
} from "../../workbench/project-tree.ts";

export interface ProjectFilesState {
  root: string | null;
  paths: string[];
  files: ProjectFile[];
  ignoredEntries: ProjectIgnoredEntry[];
  loading: boolean;
  error: string | null;
  truncated: boolean;
  selection: ProjectTreeSelection | null;
  expandedDirectories: Set<string>;
}

export type ProjectFilesChangeReason =
  | "workspace"
  | "status"
  | "refresh-start"
  | "refresh-complete"
  | "refresh-error"
  | "selection"
  | "disclosure";

export interface ProjectFilesChange {
  reason: ProjectFilesChangeReason;
  catalogChanged?: boolean;
  selectionChanged?: boolean;
  disclosureChanged?: boolean;
  error?: string;
}

export interface ProjectFilesGateway {
  listProjectFiles(root: string): Promise<ProjectFileList>;
}

type Listener = (change: ProjectFilesChange) => void;

export class ProjectFilesController {
  readonly state: ProjectFilesState = createProjectFilesState();

  private readonly gateway: ProjectFilesGateway;
  private readonly listeners = new Set<Listener>();
  private changes: FileChange[] = [];
  private catalogRoot: string | null = null;
  private generation = 0;
  private disposed = false;
  private treeCache: {
    files: ProjectFile[];
    changes: FileChange[];
    ignoredEntries: ProjectIgnoredEntry[];
    nodes: ProjectTreeNode[];
  } | null = null;

  constructor(gateway: ProjectFilesGateway) {
    this.gateway = gateway;
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  installWorkspace(root: string | null, changes: FileChange[] = []): void {
    const rootChanged = this.state.root !== root;
    this.state.root = root;
    this.changes = changes;
    this.treeCache = null;
    if (rootChanged) {
      this.generation += 1;
      this.catalogRoot = null;
      this.state.paths = [];
      this.state.files = [];
      this.state.ignoredEntries = [];
      this.state.loading = false;
      this.state.error = null;
      this.state.truncated = false;
      this.state.selection = null;
      this.state.expandedDirectories.clear();
    } else {
      this.reconcileTreeState();
    }
    this.emit({
      reason: rootChanged ? "workspace" : "status",
      catalogChanged: true,
      selectionChanged: rootChanged,
      disclosureChanged: rootChanged,
    });
  }

  updateChanges(changes: FileChange[]): void {
    if (this.changes === changes) return;
    this.changes = changes;
    this.treeCache = null;
    this.reconcileTreeState();
    this.emit({ reason: "status", catalogChanged: true });
  }

  async refresh(): Promise<boolean> {
    const root = this.state.root;
    if (!root || this.disposed) return false;
    const generation = ++this.generation;
    this.state.loading = true;
    this.state.error = null;
    this.emit({ reason: "refresh-start" });
    try {
      const result = await this.gateway.listProjectFiles(root);
      if (!this.requestMatches(generation, root) || result.root !== root) return false;
      this.state.paths = result.paths;
      this.state.files = result.files;
      this.state.ignoredEntries = result.ignoredEntries;
      this.state.truncated = result.truncated;
      this.state.loading = false;
      this.state.error = null;
      this.treeCache = null;
      if (this.catalogRoot !== result.root) {
        this.catalogRoot = result.root;
        this.state.selection = null;
        this.state.expandedDirectories = defaultExpandedProjectDirectories(this.tree());
      } else {
        this.reconcileTreeState();
      }
      this.emit({
        reason: "refresh-complete",
        catalogChanged: true,
        selectionChanged: true,
        disclosureChanged: true,
      });
      return true;
    } catch (error) {
      if (!this.requestMatches(generation, root)) return false;
      this.state.loading = false;
      this.state.error = errorMessage(error);
      this.emit({ reason: "refresh-error", error: this.state.error });
      return false;
    }
  }

  tree(): ProjectTreeNode[] {
    const cached = this.treeCache;
    if (
      cached &&
      cached.files === this.state.files &&
      cached.changes === this.changes &&
      cached.ignoredEntries === this.state.ignoredEntries
    ) {
      return cached.nodes;
    }
    const nodes = buildProjectTree(
      projectTreeEntries(this.state.files, this.changes, this.state.ignoredEntries),
    );
    this.treeCache = {
      files: this.state.files,
      changes: this.changes,
      ignoredEntries: this.state.ignoredEntries,
      nodes,
    };
    return nodes;
  }

  select(path: string, kind: ProjectTreeSelection["kind"]): boolean {
    const node = findProjectTreeNode(this.tree(), path);
    if (!node || node.kind !== kind) return false;
    const changed = this.state.selection?.path !== path || this.state.selection.kind !== kind;
    this.state.selection = { path, kind };
    if (changed) this.emit({ reason: "selection", selectionChanged: true });
    return true;
  }

  setDirectoryExpanded(path: string, expanded: boolean): boolean {
    const node = findProjectTreeNode(this.tree(), path);
    if (!node || node.kind !== "directory") return false;
    const changed = expanded
      ? !this.state.expandedDirectories.has(path)
      : this.state.expandedDirectories.has(path);
    if (expanded) this.state.expandedDirectories.add(path);
    else this.state.expandedDirectories.delete(path);
    if (changed) this.emit({ reason: "disclosure", disclosureChanged: true });
    return changed;
  }

  revealFile(path: string): boolean {
    const node = findProjectTreeNode(this.tree(), path);
    if (!node || node.kind !== "file") return false;
    for (const directory of ancestorProjectDirectories(path)) {
      this.state.expandedDirectories.add(directory);
    }
    this.state.selection = { path, kind: "file" };
    this.emit({
      reason: "selection",
      selectionChanged: true,
      disclosureChanged: true,
    });
    return true;
  }

  setSelectedSubtreeExpanded(expanded: boolean): boolean {
    const selection = this.state.selection;
    if (!selection || selection.kind !== "directory") return false;
    const node = findProjectTreeNode(this.tree(), selection.path);
    if (!node || node.kind !== "directory") return false;
    for (const path of descendantProjectDirectories(node)) {
      if (expanded) this.state.expandedDirectories.add(path);
      else this.state.expandedDirectories.delete(path);
    }
    this.emit({ reason: "disclosure", disclosureChanged: true });
    return true;
  }

  fileForWorkspacePath(path: string): ProjectFile | null {
    return this.state.files.find((file) => file.workspacePath === path) ?? null;
  }

  fileForRepositoryPath(repositoryId: string, path: string): ProjectFile | null {
    return this.state.files.find(
      (file) => file.repositoryId === repositoryId && file.path === path,
    ) ?? null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.listeners.clear();
    this.treeCache = null;
  }

  private reconcileTreeState(): void {
    if (this.catalogRoot !== this.state.root) return;
    const reconciled = reconcileProjectTreeState(
      this.tree(),
      this.state.expandedDirectories,
      this.state.selection,
    );
    this.state.expandedDirectories = reconciled.expandedDirectories;
    this.state.selection = reconciled.selection;
  }

  private requestMatches(generation: number, root: string): boolean {
    return !this.disposed && generation === this.generation && this.state.root === root;
  }

  private emit(change: ProjectFilesChange): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener(change);
  }
}

export function createProjectFilesState(): ProjectFilesState {
  return {
    root: null,
    paths: [],
    files: [],
    ignoredEntries: [],
    loading: false,
    error: null,
    truncated: false,
    selection: null,
    expandedDirectories: new Set(),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Unexpected project-files error";
}
