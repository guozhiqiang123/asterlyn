import { Change, diff, type DiffConfig } from "@codemirror/merge";

interface DiffLine {
  readonly text: string;
  readonly from: number;
  readonly to: number;
}

interface LineAnchor {
  readonly a: number;
  readonly b: number;
}

interface LineChangeBlock {
  aFrom: number;
  aTo: number;
  bFrom: number;
  bTo: number;
}

const MAX_RECURSION_DEPTH = 64;
const MAX_LCS_CELLS = 65_536;
const INLINE_DIFF_CONFIG = { scanLimit: 4_000, timeout: 40 } as const;

/**
 * CodeMirror's character-first Diff deliberately falls back to a coarse result when a large file
 * exceeds its scan budget. Source files usually contain enough stable complete lines to partition
 * that expensive comparison first. Each small changed partition can then keep CodeMirror's own
 * character-level result without allowing one early insertion to mark the rest of the file.
 */
export const LINE_AWARE_DIFF_CONFIG: DiffConfig = {
  override: lineAwareDiff,
};

export function lineAwareDiff(a: string, b: string): readonly Change[] {
  if (a === b) return [];
  const linesA = diffLines(a);
  const linesB = diffLines(b);
  const blocks: LineChangeBlock[] = [];
  collectChangedBlocks(linesA, 0, linesA.length, linesB, 0, linesB.length, blocks, 0);

  const changes: Change[] = [];
  for (const block of blocks) {
    const fromA = lineOffset(linesA, block.aFrom, a.length);
    const toA = lineOffset(linesA, block.aTo, a.length);
    const fromB = lineOffset(linesB, block.bFrom, b.length);
    const toB = lineOffset(linesB, block.bTo, b.length);
    const refined = diff(a.slice(fromA, toA), b.slice(fromB, toB), INLINE_DIFF_CONFIG);
    for (const change of refined) {
      changes.push(new Change(
        fromA + change.fromA,
        fromA + change.toA,
        fromB + change.fromB,
        fromB + change.toB,
      ));
    }
  }
  return changes;
}

function collectChangedBlocks(
  a: readonly DiffLine[],
  initialAFrom: number,
  initialATo: number,
  b: readonly DiffLine[],
  initialBFrom: number,
  initialBTo: number,
  blocks: LineChangeBlock[],
  depth: number,
): void {
  let aFrom = initialAFrom;
  let aTo = initialATo;
  let bFrom = initialBFrom;
  let bTo = initialBTo;
  while (aFrom < aTo && bFrom < bTo && a[aFrom]?.text === b[bFrom]?.text) {
    aFrom += 1;
    bFrom += 1;
  }
  while (aFrom < aTo && bFrom < bTo && a[aTo - 1]?.text === b[bTo - 1]?.text) {
    aTo -= 1;
    bTo -= 1;
  }
  if (aFrom === aTo && bFrom === bTo) return;
  if (aFrom === aTo || bFrom === bTo || depth >= MAX_RECURSION_DEPTH) {
    appendBlock(blocks, { aFrom, aTo, bFrom, bTo });
    return;
  }

  let anchors = patienceAnchors(a, aFrom, aTo, b, bFrom, bTo);
  if (anchors.length === 0 && (aTo - aFrom) * (bTo - bFrom) <= MAX_LCS_CELLS) {
    anchors = lcsAnchors(a, aFrom, aTo, b, bFrom, bTo);
  }
  if (anchors.length === 0) {
    appendBlock(blocks, { aFrom, aTo, bFrom, bTo });
    return;
  }

  let nextA = aFrom;
  let nextB = bFrom;
  for (const anchor of anchors) {
    collectChangedBlocks(a, nextA, anchor.a, b, nextB, anchor.b, blocks, depth + 1);
    nextA = anchor.a + 1;
    nextB = anchor.b + 1;
  }
  collectChangedBlocks(a, nextA, aTo, b, nextB, bTo, blocks, depth + 1);
}

function patienceAnchors(
  a: readonly DiffLine[],
  aFrom: number,
  aTo: number,
  b: readonly DiffLine[],
  bFrom: number,
  bTo: number,
): LineAnchor[] {
  const aLines = lineOccurrences(a, aFrom, aTo);
  const bLines = lineOccurrences(b, bFrom, bTo);
  const candidates: LineAnchor[] = [];
  for (let index = aFrom; index < aTo; index += 1) {
    const value = a[index]?.text ?? "";
    const left = aLines.get(value);
    const right = bLines.get(value);
    if (left?.count === 1 && right?.count === 1) candidates.push({ a: index, b: right.index });
  }
  if (candidates.length < 2) return candidates;

  const tails: number[] = [];
  const previous = new Int32Array(candidates.length);
  previous.fill(-1);
  for (let index = 0; index < candidates.length; index += 1) {
    const value = candidates[index]!.b;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (candidates[tails[middle]!]!.b < value) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1]!;
    tails[low] = index;
  }

  const anchors: LineAnchor[] = [];
  let cursor = tails.at(-1) ?? -1;
  while (cursor >= 0) {
    anchors.push(candidates[cursor]!);
    cursor = previous[cursor]!;
  }
  return anchors.reverse();
}

function lcsAnchors(
  a: readonly DiffLine[],
  aFrom: number,
  aTo: number,
  b: readonly DiffLine[],
  bFrom: number,
  bTo: number,
): LineAnchor[] {
  const rows = aTo - aFrom;
  const columns = bTo - bFrom;
  const width = columns + 1;
  const lengths = new Uint32Array((rows + 1) * width);
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      const cell = row * width + column;
      lengths[cell] = a[aFrom + row]?.text === b[bFrom + column]?.text
        ? 1 + lengths[(row + 1) * width + column + 1]!
        : Math.max(lengths[(row + 1) * width + column]!, lengths[cell + 1]!);
    }
  }

  const anchors: LineAnchor[] = [];
  let row = 0;
  let column = 0;
  while (row < rows && column < columns) {
    if (a[aFrom + row]?.text === b[bFrom + column]?.text) {
      anchors.push({ a: aFrom + row, b: bFrom + column });
      row += 1;
      column += 1;
    } else if (lengths[(row + 1) * width + column]! >= lengths[row * width + column + 1]!) {
      row += 1;
    } else {
      column += 1;
    }
  }
  return anchors;
}

function lineOccurrences(
  lines: readonly DiffLine[],
  from: number,
  to: number,
): Map<string, { count: number; index: number }> {
  const occurrences = new Map<string, { count: number; index: number }>();
  for (let index = from; index < to; index += 1) {
    const value = lines[index]?.text ?? "";
    const existing = occurrences.get(value);
    if (existing) existing.count += 1;
    else occurrences.set(value, { count: 1, index });
  }
  return occurrences;
}

function appendBlock(blocks: LineChangeBlock[], block: LineChangeBlock): void {
  const previous = blocks.at(-1);
  if (previous && previous.aTo === block.aFrom && previous.bTo === block.bFrom) {
    previous.aTo = block.aTo;
    previous.bTo = block.bTo;
  } else {
    blocks.push(block);
  }
}

function diffLines(value: string): DiffLine[] {
  const lines: DiffLine[] = [];
  for (let from = 0; from < value.length;) {
    const newline = value.indexOf("\n", from);
    const to = newline < 0 ? value.length : newline + 1;
    lines.push({ text: value.slice(from, to), from, to });
    from = to;
  }
  return lines;
}

function lineOffset(lines: readonly DiffLine[], index: number, documentLength: number): number {
  return index < lines.length ? lines[index]!.from : documentLength;
}
