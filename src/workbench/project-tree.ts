import type {
  ChangeKind,
  FileChange,
  ProjectFile,
  ProjectIgnoredEntry,
} from "../models";

export interface ProjectTreeEntry {
  path: string;
  kind: "directory" | "file";
  status: ChangeKind;
}

export interface ProjectTreeNode extends ProjectTreeEntry {
  name: string;
  children: ProjectTreeNode[];
}

const STATUS_PRIORITY: Record<ChangeKind, number> = {
  unmodified: 0,
  ignored: 1,
  unknown: 2,
  modified: 3,
  typeChanged: 4,
  copied: 5,
  renamed: 6,
  deleted: 7,
  untracked: 8,
  added: 9,
  unmerged: 10,
};

export function projectTreeEntries(
  files: ProjectFile[],
  changes: FileChange[],
  ignoredEntries: ProjectIgnoredEntry[],
): ProjectTreeEntry[] {
  const entries = new Map<string, ProjectTreeEntry>();
  for (const file of files) {
    mergeEntry(entries, {
      path: file.workspacePath,
      kind: "file",
      status: "unmodified",
    });
  }
  for (const change of changes) {
    mergeEntry(entries, {
      path: change.path,
      kind: "file",
      status: effectiveProjectFileStatus(change),
    });
  }
  for (const entry of ignoredEntries) {
    mergeEntry(entries, {
      path: entry.workspacePath,
      kind: entry.kind,
      status: "ignored",
    });
  }
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function effectiveProjectFileStatus(change: FileChange): ChangeKind {
  if (change.conflicted) return "unmerged";
  return strongerStatus(change.indexStatus, change.worktreeStatus);
}

export function buildProjectTree(
  input: Array<string | ProjectTreeEntry>,
): ProjectTreeNode[] {
  const root: ProjectTreeNode[] = [];
  const directories = new Map<string, ProjectTreeNode>();
  const files = new Map<string, ProjectTreeNode>();
  const entries = input.map<ProjectTreeEntry>((entry) =>
    typeof entry === "string"
      ? { path: entry, kind: "file", status: "unmodified" }
      : entry,
  );

  for (const entry of entries.sort((left, right) => left.path.localeCompare(right.path))) {
    const segments = entry.path.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    let children = root;
    let parentPath = "";
    for (const [index, name] of segments.entries()) {
      const nodePath = parentPath ? `${parentPath}/${name}` : name;
      const leaf = index === segments.length - 1;
      const kind = leaf ? entry.kind : "directory";
      if (kind === "file") {
        const existing = files.get(nodePath);
        if (existing) {
          existing.status = strongerStatus(existing.status, entry.status);
        } else if (!directories.has(nodePath)) {
          const file: ProjectTreeNode = {
            kind: "file",
            name,
            path: nodePath,
            status: entry.status,
            children: [],
          };
          files.set(nodePath, file);
          children.push(file);
        }
      } else {
        let directory = directories.get(nodePath);
        if (!directory) {
          directory = {
            kind: "directory",
            name,
            path: nodePath,
            status: leaf ? entry.status : "unmodified",
            children: [],
          };
          directories.set(nodePath, directory);
          children.push(directory);
        } else if (leaf) {
          directory.status = strongerStatus(directory.status, entry.status);
        }
        children = directory.children;
      }
      parentPath = nodePath;
    }
  }
  sortTree(root);
  return root;
}

export function defaultExpandedProjectDirectories(
  nodes: ProjectTreeNode[],
  visibleDepth = 2,
): Set<string> {
  const expanded = new Set<string>();
  visitProjectTree(nodes, (node, depth) => {
    if (node.kind === "directory" && depth < visibleDepth) expanded.add(node.path);
  });
  return expanded;
}

export function ancestorProjectDirectories(path: string): string[] {
  const segments = path.split("/").filter(Boolean);
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"));
}

export function descendantProjectDirectories(node: ProjectTreeNode): string[] {
  const paths: string[] = [];
  visitProjectTree([node], (candidate) => {
    if (candidate.kind === "directory") paths.push(candidate.path);
  });
  return paths;
}

export function findProjectTreeNode(
  nodes: ProjectTreeNode[],
  path: string,
): ProjectTreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    const found = findProjectTreeNode(node.children, path);
    if (found) return found;
  }
  return null;
}

function mergeEntry(
  entries: Map<string, ProjectTreeEntry>,
  entry: ProjectTreeEntry,
): void {
  const existing = entries.get(entry.path);
  if (!existing) {
    entries.set(entry.path, { ...entry });
    return;
  }
  existing.status = strongerStatus(existing.status, entry.status);
  if (entry.kind === "directory") existing.kind = "directory";
}

function strongerStatus(left: ChangeKind, right: ChangeKind): ChangeKind {
  return STATUS_PRIORITY[right] > STATUS_PRIORITY[left] ? right : left;
}

function visitProjectTree(
  nodes: ProjectTreeNode[],
  visit: (node: ProjectTreeNode, depth: number) => void,
  depth = 0,
): void {
  for (const node of nodes) {
    visit(node, depth);
    visitProjectTree(node.children, visit, depth + 1);
  }
}

function sortTree(nodes: ProjectTreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  for (const node of nodes) sortTree(node.children);
}
