export interface ProjectTreeNode {
  kind: "directory" | "file";
  name: string;
  path: string;
  children: ProjectTreeNode[];
}

export function buildProjectTree(paths: string[]): ProjectTreeNode[] {
  const root: ProjectTreeNode[] = [];
  const directories = new Map<string, ProjectTreeNode>();
  for (const path of Array.from(new Set(paths)).sort()) {
    const segments = path.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    let children = root;
    let parentPath = "";
    for (const [index, name] of segments.entries()) {
      const nodePath = parentPath ? `${parentPath}/${name}` : name;
      const isFile = index === segments.length - 1;
      if (isFile) {
        children.push({ kind: "file", name, path, children: [] });
      } else {
        let directory = directories.get(nodePath);
        if (!directory) {
          directory = {
            kind: "directory",
            name,
            path: nodePath,
            children: [],
          };
          directories.set(nodePath, directory);
          children.push(directory);
        }
        children = directory.children;
      }
      parentPath = nodePath;
    }
  }
  sortTree(root);
  return root;
}

function sortTree(nodes: ProjectTreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  for (const node of nodes) sortTree(node.children);
}
