export const COMPACT_FILE_TREE_ROW_HEIGHT = 25;

export interface CompactFileTreeNode<TNode> {
  readonly kind: "directory" | "file";
  readonly name: string;
  readonly path: string;
  readonly children: readonly TNode[];
}

export interface CompactDirectoryChain<TNode> {
  readonly terminal: TNode;
  readonly label: string;
  readonly paths: readonly string[];
  readonly fileCount: number;
}

/**
 * Projects a run of directories with no siblings into one visible tree row.
 * The terminal directory remains the interaction target and owns the children.
 */
export function compactDirectoryChain<
  TNode extends CompactFileTreeNode<TNode>,
>(node: TNode): CompactDirectoryChain<TNode> {
  const names = [node.name];
  const paths = [node.path];
  let terminal = node;
  while (
    terminal.kind === "directory" &&
    terminal.children.length === 1 &&
    terminal.children[0]?.kind === "directory"
  ) {
    terminal = terminal.children[0];
    names.push(terminal.name);
    paths.push(terminal.path);
  }
  return {
    terminal,
    label: names.join("/"),
    paths,
    fileCount: countCompactTreeFiles(terminal),
  };
}

export function countCompactTreeFiles<
  TNode extends CompactFileTreeNode<TNode>,
>(node: TNode): number {
  return node.kind === "file"
    ? 1
    : node.children.reduce((count, child) => count + countCompactTreeFiles(child), 0);
}
