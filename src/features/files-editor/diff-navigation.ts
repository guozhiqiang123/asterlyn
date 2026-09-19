import type { SourceDiffRow } from "../../diff-presentation.ts";

export type DiffDirection = -1 | 1;

export interface DiffChangeBlock {
  fromLine: number;
  toLine: number;
}

export function splitChangeBlocks(rows: readonly SourceDiffRow[]): DiffChangeBlock[] {
  return groupedBlocks(
    rows.map((row) =>
      row.kind === "added" || row.kind === "removed" || row.kind === "modified",
    ),
  );
}

export function splitChangeStartLines(rows: readonly SourceDiffRow[]): number[] {
  return splitChangeBlocks(rows).map((block) => block.fromLine);
}

export function unifiedChangeBlocks(document: string): DiffChangeBlock[] {
  const lines = document.split("\n");
  let inHunk = false;
  return groupedBlocks(
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

export function unifiedChangeStartLines(document: string): number[] {
  return unifiedChangeBlocks(document).map((block) => block.fromLine);
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

function groupedBlocks(changed: readonly boolean[]): DiffChangeBlock[] {
  const blocks: DiffChangeBlock[] = [];
  let start: number | null = null;
  for (const [index, current] of changed.entries()) {
    const line = index + 1;
    if (current && start === null) start = line;
    if (!current && start !== null) {
      blocks.push({ fromLine: start, toLine: line - 1 });
      start = null;
    }
  }
  if (start !== null) blocks.push({ fromLine: start, toLine: changed.length });
  return blocks;
}
