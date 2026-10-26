export function markdownSplitRange(width: number): { minimum: number; maximum: number } {
  const usableWidth = Math.max(0, width - 5);
  const minimum = Math.min(220, usableWidth / 2);
  return { minimum, maximum: Math.max(minimum, usableWidth - minimum) };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}
