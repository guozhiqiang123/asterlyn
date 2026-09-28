interface FileTreeNodeIdentity {
  readonly kind: "directory" | "file";
  readonly name: string;
  readonly path: string;
}

export function compareFilePathsByName(leftPath: string, rightPath: string): number {
  const byName = basename(leftPath).localeCompare(basename(rightPath));
  return byName || leftPath.localeCompare(rightPath);
}

export function sortFilesByName<T extends { readonly path: string }>(
  files: readonly T[],
): T[] {
  return [...files].sort((left, right) => compareFilePathsByName(left.path, right.path));
}

export function compareFileTreeNodes(
  left: FileTreeNodeIdentity,
  right: FileTreeNodeIdentity,
): number {
  if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
  return left.name.localeCompare(right.name) || left.path.localeCompare(right.path);
}

function basename(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? path : path.slice(separator + 1);
}
