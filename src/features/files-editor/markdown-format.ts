export const MARKDOWN_PREVIEW_MAX_BYTES = 512 * 1024;

export function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown|mdown|mkd)$/iu.test(path);
}
