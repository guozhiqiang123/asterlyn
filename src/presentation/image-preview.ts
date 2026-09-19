const IMAGE_EXTENSIONS = new Set([
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "webp",
]);

export function isImagePreviewPath(path: string): boolean {
  const name = path.split(/[\\/]/).at(-1) ?? "";
  const separator = name.lastIndexOf(".");
  if (separator <= 0 || separator === name.length - 1) return false;
  return IMAGE_EXTENSIONS.has(name.slice(separator + 1).toLowerCase());
}

export interface ImageRequestIdentity {
  generation: number;
  workspaceRoot: string | null;
  documentKey: string;
}

export function isCurrentImageRequest(
  expected: ImageRequestIdentity,
  current: ImageRequestIdentity,
): boolean {
  return (
    expected.generation === current.generation &&
    expected.workspaceRoot === current.workspaceRoot &&
    expected.documentKey === current.documentKey
  );
}
