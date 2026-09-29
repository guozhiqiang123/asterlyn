import type { ProjectFile, WorkspaceTextSearchMatch, WorkspaceTextSearchReport } from "../../models.ts";
import { sortFilesByName } from "../../presentation/file-name-order.ts";
import {
  buildProjectTree,
  descendantProjectDirectories,
  findProjectTreeNode,
  type ProjectTreeNode,
  type ProjectTreeSelection,
} from "../../presentation/project-tree.ts";

export type FindFileView = "tree" | "flat";

export interface FindTextResultsSnapshot {
  readonly kind: "workspace";
  readonly repositoryRoot: string;
  readonly query: string;
  readonly report: WorkspaceTextSearchReport;
}

export interface FindFileResultsSnapshot {
  readonly kind: "files" | "recent";
  readonly repositoryRoot: string;
  readonly query: string;
  readonly files: readonly ProjectFile[];
}

export type FindResultsSnapshot = FindTextResultsSnapshot | FindFileResultsSnapshot;

export interface FindResultsState {
  readonly snapshot: FindResultsSnapshot | null;
  readonly selectedIndex: number;
  readonly fileSelection: ProjectTreeSelection | null;
  readonly fileView: FindFileView;
  readonly expandedDirectories: ReadonlySet<string>;
}

export class FindResultsController {
  private value: FindResultsState = emptyState("tree");

  get state(): Readonly<FindResultsState> {
    return this.value;
  }

  install(
    repositoryRoot: string,
    query: string,
    report: WorkspaceTextSearchReport,
  ): boolean {
    if (!repositoryRoot || !query.trim() || report.matches.length === 0) return false;
    this.value = {
      ...emptyState(this.value.fileView),
      snapshot: { kind: "workspace", repositoryRoot, query, report },
    };
    return true;
  }

  installFiles(
    kind: "files" | "recent",
    repositoryRoot: string,
    query: string,
    files: readonly ProjectFile[],
  ): boolean {
    if (!repositoryRoot || files.length === 0) return false;
    const snapshot: FindFileResultsSnapshot = { kind, repositoryRoot, query, files: [...files] };
    const first = sortedFindFiles(snapshot)[0] ?? null;
    this.value = {
      snapshot,
      selectedIndex: 0,
      fileSelection: first ? { path: first.workspacePath, kind: "file" } : null,
      fileView: this.value.fileView,
      expandedDirectories: new Set(allDirectoryPaths(findFileTree(snapshot))),
    };
    return true;
  }

  clear(): void {
    this.value = emptyState(this.value.fileView);
  }

  select(index: number): boolean {
    const snapshot = this.value.snapshot;
    const count = snapshot?.kind === "workspace" ? snapshot.report.matches.length : 0;
    if (!Number.isInteger(index) || index < 0 || index >= count) return false;
    if (this.value.selectedIndex === index) return false;
    this.value = { ...this.value, selectedIndex: index };
    return true;
  }

  move(delta: number): boolean {
    const snapshot = this.value.snapshot;
    const count = snapshot?.kind === "workspace" ? snapshot.report.matches.length : 0;
    if (count === 0) return false;
    const selectedIndex = (this.value.selectedIndex + delta % count + count) % count;
    if (selectedIndex === this.value.selectedIndex) return false;
    this.value = { ...this.value, selectedIndex };
    return true;
  }

  selectFile(path: string, kind: ProjectTreeSelection["kind"]): boolean {
    const snapshot = fileSnapshot(this.value.snapshot);
    const node = snapshot ? findProjectTreeNode(findFileTree(snapshot), path) : null;
    if (!node || node.kind !== kind) return false;
    if (this.value.fileSelection?.path === path && this.value.fileSelection.kind === kind) return false;
    this.value = { ...this.value, fileSelection: { path, kind } };
    return true;
  }

  toggleDirectory(path: string): boolean {
    const snapshot = fileSnapshot(this.value.snapshot);
    const node = snapshot ? findProjectTreeNode(findFileTree(snapshot), path) : null;
    if (!node || node.kind !== "directory") return false;
    const expandedDirectories = new Set(this.value.expandedDirectories);
    if (expandedDirectories.has(path)) expandedDirectories.delete(path);
    else expandedDirectories.add(path);
    this.value = { ...this.value, fileSelection: { path, kind: "directory" }, expandedDirectories };
    return true;
  }

  toggleFileView(): boolean {
    const snapshot = fileSnapshot(this.value.snapshot);
    if (!snapshot) return false;
    const fileView = this.value.fileView === "tree" ? "flat" : "tree";
    const first = fileView === "flat" && this.value.fileSelection?.kind === "directory"
      ? sortedFindFiles(snapshot)[0] ?? null
      : null;
    this.value = {
      ...this.value,
      fileView,
      fileSelection: first ? { path: first.workspacePath, kind: "file" } : this.value.fileSelection,
    };
    return true;
  }

  setSelectedSubtreeExpanded(expanded: boolean): boolean {
    const snapshot = fileSnapshot(this.value.snapshot);
    const selection = this.value.fileSelection;
    const node = snapshot && selection?.kind === "directory"
      ? findProjectTreeNode(findFileTree(snapshot), selection.path)
      : null;
    if (!node || node.kind !== "directory") return false;
    const expandedDirectories = new Set(this.value.expandedDirectories);
    for (const path of descendantProjectDirectories(node)) {
      if (expanded) expandedDirectories.add(path);
      else expandedDirectories.delete(path);
    }
    this.value = { ...this.value, expandedDirectories };
    return true;
  }

  selectedMatch(): WorkspaceTextSearchMatch | null {
    const snapshot = this.value.snapshot;
    return snapshot?.kind === "workspace" ? snapshot.report.matches[this.value.selectedIndex] ?? null : null;
  }

  selectedFile(): ProjectFile | null {
    const snapshot = fileSnapshot(this.value.snapshot);
    const selection = this.value.fileSelection;
    return selection?.kind === "file"
      ? snapshot?.files.find((file) => file.workspacePath === selection.path) ?? null
      : null;
  }
}

export function findFileTree(snapshot: FindFileResultsSnapshot): ProjectTreeNode[] {
  return buildProjectTree(snapshot.files.map((file) => file.workspacePath));
}

export function sortedFindFiles(snapshot: FindFileResultsSnapshot): ProjectFile[] {
  const byPath = new Map(snapshot.files.map((file) => [file.workspacePath, file]));
  return sortFilesByName(snapshot.files.map((file) => ({ path: file.workspacePath })))
    .map((entry) => byPath.get(entry.path)!)
    .filter(Boolean);
}

function fileSnapshot(snapshot: FindResultsSnapshot | null): FindFileResultsSnapshot | null {
  return snapshot && snapshot.kind !== "workspace" ? snapshot : null;
}

function allDirectoryPaths(nodes: readonly ProjectTreeNode[]): string[] {
  return nodes.flatMap((node) => node.kind === "directory" ? descendantProjectDirectories(node) : []);
}

function emptyState(fileView: FindFileView): FindResultsState {
  return { snapshot: null, selectedIndex: 0, fileSelection: null, fileView, expandedDirectories: new Set() };
}
