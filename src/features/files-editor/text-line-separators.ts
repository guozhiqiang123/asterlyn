import type { ExactTextContent, LineSeparator } from "./text-content.ts";

export interface LineSeparatorCounts {
  lf: number;
  crlf: number;
}

export interface LineSeparatorChange {
  separatorStart: number;
  removedSeparators: number;
  insertedSeparators: number;
}

export function countLineSeparators(
  separators: readonly LineSeparator[],
): LineSeparatorCounts {
  let lf = 0;
  let crlf = 0;
  for (const separator of separators) {
    if (separator === "\r\n") crlf += 1;
    else lf += 1;
  }
  return { lf, crlf };
}

export function applyLineSeparatorChanges(
  content: ExactTextContent,
  counts: LineSeparatorCounts,
  changes: readonly LineSeparatorChange[],
): void {
  const insertionSeparator = content.dominantSeparator;
  const ordered = [...changes].sort(
    (left, right) => right.separatorStart - left.separatorStart,
  );
  for (const change of ordered) {
    const removed = content.separators.slice(
      change.separatorStart,
      change.separatorStart + change.removedSeparators,
    );
    for (const separator of removed) {
      if (separator === "\r\n") counts.crlf -= 1;
      else counts.lf -= 1;
    }
    const inserted = Array<LineSeparator>(change.insertedSeparators).fill(
      insertionSeparator,
    );
    if (inserted.length <= 8_192) {
      content.separators.splice(
        change.separatorStart,
        change.removedSeparators,
        ...inserted,
      );
    } else {
      content.separators = [
        ...content.separators.slice(0, change.separatorStart),
        ...inserted,
        ...content.separators.slice(
          change.separatorStart + change.removedSeparators,
        ),
      ];
    }
    if (insertionSeparator === "\r\n") counts.crlf += change.insertedSeparators;
    else counts.lf += change.insertedSeparators;
  }
  content.dominantSeparator = counts.crlf === counts.lf
    ? content.separators[0] ?? "\n"
    : counts.crlf > counts.lf
      ? "\r\n"
      : "\n";
}
