import type { ChangeKind, FileChange } from "../models";

export type ChangeFileView = "tree" | "flat";
export type ChangeGroupId = "changes" | "unversioned";

export interface ChangeFileTreeNode {
  kind: "directory" | "file";
  name: string;
  path: string;
  children: ChangeFileTreeNode[];
  change: FileChange | null;
}

export function changeGroup(change: FileChange): ChangeGroupId {
  return change.worktreeStatus === "untracked" ? "unversioned" : "changes";
}

export function effectiveChangeKind(change: FileChange): ChangeKind {
  if (change.conflicted) return "unmerged";
  if (change.worktreeStatus !== "unmodified" && change.worktreeStatus !== "ignored") {
    return change.worktreeStatus;
  }
  return change.indexStatus;
}

export function includedChanges(
  changes: FileChange[],
  excludedPaths: ReadonlySet<string>,
): FileChange[] {
  return changes.filter((change) => !excludedPaths.has(change.path));
}

export function reconcileExcludedChangePaths(
  excludedPaths: ReadonlySet<string>,
  changes: FileChange[],
): Set<string> {
  const current = new Set(changes.map((change) => change.path));
  return new Set(Array.from(excludedPaths).filter((path) => current.has(path)));
}

export function buildChangeFileTree(changes: FileChange[]): ChangeFileTreeNode[] {
  const root: ChangeFileTreeNode[] = [];
  const directories = new Map<string, ChangeFileTreeNode>();
  for (const change of [...changes].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    const segments = change.path.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    let children = root;
    let parentPath = "";
    for (const [index, name] of segments.entries()) {
      const path = parentPath ? `${parentPath}/${name}` : name;
      if (index === segments.length - 1) {
        children.push({ kind: "file", name, path: change.path, children: [], change });
      } else {
        let directory = directories.get(path);
        if (!directory) {
          directory = { kind: "directory", name, path, children: [], change: null };
          directories.set(path, directory);
          children.push(directory);
        }
        children = directory.children;
      }
      parentPath = path;
    }
  }
  sortChangeTree(root);
  return root;
}

export function descendantChangePaths(node: ChangeFileTreeNode): string[] {
  if (node.kind === "file") return [node.path];
  return node.children.flatMap(descendantChangePaths);
}

function sortChangeTree(nodes: ChangeFileTreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  for (const node of nodes) sortChangeTree(node.children);
}
