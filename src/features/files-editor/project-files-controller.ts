import type {
  FileChange,
  ProjectFile,
  ProjectFileList,
  ProjectIgnoredEntry,
} from "../../models.ts";
import {
  ancestorProjectDirectories,
  buildProjectTree,
  descendantProjectDirectories,
  findProjectTreeNode,
  projectTreeEntries,
  reconcileProjectTreeState,
  type ProjectTreeNode,
  type ProjectTreeSelection,
} from "../../presentation/project-tree.ts";
import type { EditorCopy } from "../../localization/catalog.ts";
import { EN_US } from "../../localization/en-US.ts";

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
  private refreshRoot: string | null = null;
  private refreshGeneration: number | null = null;
  private refreshPromise: Promise<boolean> | null = null;
  private messages: Pick<EditorCopy, "unexpectedProjectFilesError">;
  private treeCache: {
    files: ProjectFile[];
    changes: FileChange[];
    ignoredEntries: ProjectIgnoredEntry[];
    nodes: ProjectTreeNode[];
  } | null = null;

  constructor(
    gateway: ProjectFilesGateway,
    messages: Pick<EditorCopy, "unexpectedProjectFilesError"> = EN_US.editor,
  ) {
    this.gateway = gateway;
    this.messages = messages;
  }

  setMessages(messages: Pick<EditorCopy, "unexpectedProjectFilesError">): void {
    this.messages = messages;
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  installWorkspace(root: string | null, changes: FileChange[] = []): void {
    const rootChanged = this.state.root !== root;
    if (!rootChanged) { this.updateChanges(changes); return; }
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
    if (this.changes === changes || (this.changes.length === changes.length &&
      this.changes.every((previous, index) => sameChange(previous, changes[index]!)))) return;
    this.changes = changes;
    this.treeCache = null;
    this.reconcileTreeState();
    this.emit({ reason: "status", catalogChanged: true });
  }

  refresh(): Promise<boolean> {
    const root = this.state.root;
    if (!root || this.disposed) return Promise.resolve(false);
    if (
      this.refreshRoot === root &&
      this.refreshGeneration === this.generation &&
      this.refreshPromise
    ) return this.refreshPromise;
    const request = this.performRefresh(root);
    this.refreshRoot = root;
    this.refreshGeneration = this.generation;
    this.refreshPromise = request;
    const release = () => {
      if (this.refreshPromise !== request) return;
      this.refreshRoot = null;
      this.refreshGeneration = null;
      this.refreshPromise = null;
    };
    void request.then(release, release);
    return request;
  }

  private async performRefresh(root: string): Promise<boolean> {
    const generation = ++this.generation;
    const hadError = this.state.error !== null;
    this.state.loading = true;
    this.state.error = null;
    this.emit({ reason: "refresh-start" });
    try {
      const result = await this.gateway.listProjectFiles(root);
      if (!this.requestMatches(generation, root) || result.root !== root) return false;
      if (this.catalogRoot === result.root && !hadError && this.state.truncated === result.truncated &&
        sameRecords(this.state.files, result.files) && sameRecords(this.state.ignoredEntries, result.ignoredEntries)) {
        this.state.loading = false;
        this.emit({ reason: "refresh-complete", catalogChanged: false });
        return true;
      }
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
        this.state.expandedDirectories.clear();
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
      this.state.error = errorMessage(error, this.messages.unexpectedProjectFilesError);
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

  /**
   * The workspace root is addressed by the Files navigator header. It owns no tree row, so it keeps
   * the current row selection and only reports whether an open workspace can receive root actions.
   */
  selectRoot(): boolean {
    return this.state.root !== null;
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

  revealDirectory(path: string): boolean {
    const node = findProjectTreeNode(this.tree(), path);
    if (!node || node.kind !== "directory") return false;
    for (const directory of ancestorProjectDirectories(path)) {
      this.state.expandedDirectories.add(directory);
    }
    this.state.selection = { path, kind: "directory" };
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

function sameChange(a: FileChange, b: FileChange): boolean {
  return a.path === b.path && a.originalPath === b.originalPath &&
    a.indexStatus === b.indexStatus && a.worktreeStatus === b.worktreeStatus &&
    a.conflicted === b.conflicted && a.submodule === b.submodule;
}

function sameRecords<T extends object>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((item, index) => {
    const next = b[index]!;
    return Object.keys(item).length === Object.keys(next).length &&
      (Object.keys(item) as Array<keyof T>).every((key) => item[key] === next[key]);
  });
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

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return fallback;
}
