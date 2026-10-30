export function workspaceFileUri(root: string, path: string): string | null {
  if (path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) return null;
  const normalized = root.replace(/\\/gu, "/").replace(/\/$/u, "");
  const parts = normalized.split("/").map((part, index) => index === 0 && /^[A-Za-z]:$/u.test(part) ? part : encodeURIComponent(part)).join("/");
  if (!normalized.startsWith("/") && !/^[A-Za-z]:\//u.test(normalized)) return null;
  return `file://${normalized.startsWith("/") ? "" : "/"}${parts}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
