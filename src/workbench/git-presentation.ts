import type { BranchSummary, CommitFileChange } from "../models";

export type CommitFileView = "tree" | "flat";
export type CommitReferenceKind = "head" | "local" | "remote" | "tag" | "other";

export interface CommitReference {
  kind: CommitReferenceKind;
  label: string;
}

export interface CommitFileTreeNode {
  kind: "directory" | "file";
  name: string;
  path: string;
  children: CommitFileTreeNode[];
  file: CommitFileChange | null;
}

export interface RemoteBranchGroup {
  name: string;
  branches: Array<{ branch: BranchSummary; displayName: string }>;
}

export function commitReferences(
  decorations: string[],
  branches: Pick<BranchSummary, "kind" | "name">[] = [],
): CommitReference[] {
  const references: CommitReference[] = [];
  for (const decoration of decorations) {
    const value = decoration.trim();
    if (!value) continue;
    if (value.startsWith("HEAD -> ")) {
      references.push({ kind: "head", label: "HEAD" });
      references.push({ kind: "local", label: value.slice("HEAD -> ".length) });
      continue;
    }
    if (value === "HEAD") {
      references.push({ kind: "head", label: value });
      continue;
    }
    if (value.startsWith("tag: ")) {
      references.push({ kind: "tag", label: value.slice("tag: ".length) });
      continue;
    }
    const symbolic = value.split(" -> ");
    for (const label of symbolic) {
      references.push({ kind: decorationKind(label, branches), label });
    }
  }
  return references.filter(
    (reference, index) =>
      references.findIndex(
        (candidate) =>
          candidate.kind === reference.kind && candidate.label === reference.label,
      ) === index,
  );
}

function decorationKind(
  label: string,
  branches: Pick<BranchSummary, "kind" | "name">[],
): CommitReferenceKind {
  return branches.find((branch) => branch.name === label)?.kind ?? "other";
}

export function buildCommitFileTree(files: CommitFileChange[]): CommitFileTreeNode[] {
  const root: CommitFileTreeNode[] = [];
  const directories = new Map<string, CommitFileTreeNode>();
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    const segments = file.path.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    let children = root;
    let parentPath = "";
    for (const [index, name] of segments.entries()) {
      const path = parentPath ? `${parentPath}/${name}` : name;
      if (index === segments.length - 1) {
        children.push({ kind: "file", name, path: file.path, children: [], file });
      } else {
        let directory = directories.get(path);
        if (!directory) {
          directory = {
            kind: "directory",
            name,
            path,
            children: [],
            file: null,
          };
          directories.set(path, directory);
          children.push(directory);
        }
        children = directory.children;
      }
      parentPath = path;
    }
  }
  sortCommitTree(root);
  return root;
}

export function groupRemoteBranches(branches: BranchSummary[]): RemoteBranchGroup[] {
  const groups = new Map<string, RemoteBranchGroup>();
  for (const branch of branches.filter((candidate) => candidate.kind === "remote")) {
    const separator = branch.name.indexOf("/");
    const remote = separator < 0 ? branch.name : branch.name.slice(0, separator);
    const displayName = separator < 0 ? branch.name : branch.name.slice(separator + 1);
    const group = groups.get(remote) ?? { name: remote, branches: [] };
    group.branches.push({ branch, displayName });
    groups.set(remote, group);
  }
  return Array.from(groups.values())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((group) => ({
      ...group,
      branches: group.branches.sort((left, right) =>
        left.displayName.localeCompare(right.displayName),
      ),
    }));
}

function sortCommitTree(nodes: CommitFileTreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  for (const node of nodes) sortCommitTree(node.children);
}
