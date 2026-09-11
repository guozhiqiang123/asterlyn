import type { SourceDiffRow } from "../diff-presentation.ts";

export type DiffDirection = -1 | 1;

export function splitChangeStartLines(rows: readonly SourceDiffRow[]): number[] {
  return groupedStarts(
    rows.map((row) =>
      row.kind === "added" || row.kind === "removed" || row.kind === "modified",
    ),
  );
}

export function unifiedChangeStartLines(document: string): number[] {
  const lines = document.split("\n");
  let inHunk = false;
  return groupedStarts(
    lines.map((line) => {
      if (line.startsWith("diff --git ")) inHunk = false;
      if (line.startsWith("@@")) {
        inHunk = true;
        return false;
      }
      return inHunk && (line.startsWith("+") || line.startsWith("-"));
    }),
  );
}

export function adjacentDiffItem<T>(
  items: readonly T[],
  current: T,
  direction: DiffDirection,
): T | null {
  const index = items.indexOf(current);
  if (index < 0) return null;
  return items[index + direction] ?? null;
}

function groupedStarts(changed: readonly boolean[]): number[] {
  const starts: number[] = [];
  let previous = false;
  for (const [index, current] of changed.entries()) {
    if (current && !previous) starts.push(index + 1);
    previous = current;
  }
  return starts;
}
