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

interface AlignedLineGroup {
  readonly aFrom: number;
  readonly aTo: number;
  readonly bFrom: number;
  readonly bTo: number;
}

const MAX_RECURSION_DEPTH = 64;
const MAX_LCS_CELLS = 65_536;
const MAX_GROUP_ALIGNMENT_CELLS = 4_096;
const MAX_ALIGNED_GROUP_LINES = 3;
const GROUP_GAP_SCORE = -0.45;
const MIN_GROUP_SIMILARITY = 0.62;
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
    refineChangedBlock(linesA, linesB, block, changes);
  }
  return changes;
}

function refineChangedBlock(
  linesA: readonly DiffLine[],
  linesB: readonly DiffLine[],
  block: LineChangeBlock,
  changes: Change[],
): void {
  const blockA = linesA.slice(block.aFrom, block.aTo);
  const blockB = linesB.slice(block.bFrom, block.bTo);
  let cursorA = lineOffset(linesA, block.aFrom, linesA.at(-1)?.to ?? 0);
  let cursorB = lineOffset(linesB, block.bFrom, linesB.at(-1)?.to ?? 0);
  for (const group of alignLineGroups(blockA, blockB)) {
    const firstA = blockA[group.aFrom] ?? null;
    const lastA = blockA[group.aTo - 1] ?? null;
    const firstB = blockB[group.bFrom] ?? null;
    const lastB = blockB[group.bTo - 1] ?? null;
    if (firstA && lastA && firstB && lastB) {
      const textA = blockA.slice(group.aFrom, group.aTo).map((line) => line.text).join("");
      const textB = blockB.slice(group.bFrom, group.bTo).map((line) => line.text).join("");
      for (const change of diff(textA, textB, INLINE_DIFF_CONFIG)) {
        changes.push(new Change(
          firstA.from + change.fromA,
          firstA.from + change.toA,
          firstB.from + change.fromB,
          firstB.from + change.toB,
        ));
      }
      cursorA = lastA.to;
      cursorB = lastB.to;
    } else if (firstA && lastA) {
      changes.push(new Change(firstA.from, lastA.to, cursorB, cursorB));
      cursorA = lastA.to;
    } else if (firstB && lastB) {
      changes.push(new Change(cursorA, cursorA, firstB.from, lastB.to));
      cursorB = lastB.to;
    }
  }
}

function alignLineGroups(a: readonly DiffLine[], b: readonly DiffLine[]): AlignedLineGroup[] {
  if (a.length === 0) return b.map((_, index) => ({ aFrom: 0, aTo: 0, bFrom: index, bTo: index + 1 }));
  if (b.length === 0) return a.map((_, index) => ({ aFrom: index, aTo: index + 1, bFrom: 0, bTo: 0 }));
  if (a.length === 1 && b.length === 1) return [{ aFrom: 0, aTo: 1, bFrom: 0, bTo: 1 }];
  if (a.length * b.length > MAX_GROUP_ALIGNMENT_CELLS) return offsetLineGroups(a.length, b.length);

  const columns = b.length + 1;
  const scores = new Float64Array((a.length + 1) * columns);
  scores.fill(Number.NEGATIVE_INFINITY);
  scores[0] = 0;
  const stepsA = new Uint8Array(scores.length);
  const stepsB = new Uint8Array(scores.length);
  for (let aFrom = 0; aFrom <= a.length; aFrom += 1) {
    for (let bFrom = 0; bFrom <= b.length; bFrom += 1) {
      const score = scores[aFrom * columns + bFrom] ?? Number.NEGATIVE_INFINITY;
      if (!Number.isFinite(score)) continue;
      if (aFrom < a.length) updateAlignmentCell(
        scores, stepsA, stepsB, columns, aFrom + 1, bFrom,
        score + GROUP_GAP_SCORE, 1, 0,
      );
      if (bFrom < b.length) updateAlignmentCell(
        scores, stepsA, stepsB, columns, aFrom, bFrom + 1,
        score + GROUP_GAP_SCORE, 0, 1,
      );
      for (let aSize = 1; aSize <= Math.min(MAX_ALIGNED_GROUP_LINES, a.length - aFrom); aSize += 1) {
        for (let bSize = 1; bSize <= Math.min(MAX_ALIGNED_GROUP_LINES, b.length - bFrom); bSize += 1) {
          const similarity = lineGroupSimilarity(a, aFrom, aSize, b, bFrom, bSize);
          if (similarity < MIN_GROUP_SIMILARITY) continue;
          const pairScore = 2 * similarity - 0.8 - 0.08 * (aSize + bSize - 2);
          updateAlignmentCell(
            scores, stepsA, stepsB, columns, aFrom + aSize, bFrom + bSize,
            score + pairScore, aSize, bSize,
          );
        }
      }
    }
  }

  const groups: AlignedLineGroup[] = [];
  let aTo = a.length;
  let bTo = b.length;
  while (aTo > 0 || bTo > 0) {
    const cell = aTo * columns + bTo;
    let aSize = stepsA[cell] ?? 0;
    let bSize = stepsB[cell] ?? 0;
    if (aSize === 0 && bSize === 0) {
      aSize = aTo > 0 ? 1 : 0;
      bSize = aSize === 0 && bTo > 0 ? 1 : 0;
    }
    groups.push({ aFrom: aTo - aSize, aTo, bFrom: bTo - bSize, bTo });
    aTo -= aSize;
    bTo -= bSize;
  }
  return groups.reverse();
}

function updateAlignmentCell(
  scores: Float64Array,
  stepsA: Uint8Array,
  stepsB: Uint8Array,
  columns: number,
  aTo: number,
  bTo: number,
  score: number,
  aSize: number,
  bSize: number,
): void {
  const cell = aTo * columns + bTo;
  if (score <= scores[cell]!) return;
  scores[cell] = score;
  stepsA[cell] = aSize;
  stepsB[cell] = bSize;
}

function lineGroupSimilarity(
  a: readonly DiffLine[],
  aFrom: number,
  aSize: number,
  b: readonly DiffLine[],
  bFrom: number,
  bSize: number,
): number {
  const textA = a.slice(aFrom, aFrom + aSize).map((line) => line.text).join("");
  const textB = b.slice(bFrom, bFrom + bSize).map((line) => line.text).join("");
  const tokensA = lineTokens(textA);
  const tokensB = lineTokens(textB);
  const counts = new Map<string, number>();
  for (const token of tokensA) counts.set(token, (counts.get(token) ?? 0) + 1);
  let overlap = 0;
  for (const token of tokensB) {
    const available = counts.get(token) ?? 0;
    if (available <= 0) continue;
    overlap += 1;
    counts.set(token, available - 1);
  }
  const tokenSimilarity = tokensA.length + tokensB.length === 0
    ? 0
    : (2 * overlap) / (tokensA.length + tokensB.length);
  const compactA = textA.replace(/\s+/gu, "");
  const compactB = textB.replace(/\s+/gu, "");
  const longest = Math.max(compactA.length, compactB.length);
  const lengthSimilarity = longest === 0 ? 1 : 1 - Math.abs(compactA.length - compactB.length) / longest;
  const edgeSimilarity = sharedEdgeSimilarity(compactA, compactB);
  const similarity = 0.65 * tokenSimilarity + 0.25 * edgeSimilarity + 0.1 * lengthSimilarity;
  const keyA = aSize === 1 ? leadingPropertyKey(textA) : null;
  const keyB = bSize === 1 ? leadingPropertyKey(textB) : null;
  return keyA !== null && keyA === keyB ? Math.max(similarity, 0.86) : similarity;
}

function leadingPropertyKey(text: string): string | null {
  return /^\s*(--?[\p{Alphabetic}_][\p{Alphabetic}\p{Number}_-]*|[\p{Alphabetic}_][\p{Alphabetic}\p{Number}_-]*)\s*:/u.exec(text)?.[1] ?? null;
}

function sharedEdgeSimilarity(a: string, b: string): number {
  let prefix = 0;
  const prefixLimit = Math.min(a.length, b.length);
  while (prefix < prefixLimit && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - suffix - 1] === b[b.length - suffix - 1]
  ) {
    suffix += 1;
  }
  const totalLength = a.length + b.length;
  return totalLength === 0 ? 1 : (2 * (prefix + suffix)) / totalLength;
}

function lineTokens(text: string): string[] {
  return text.match(/[\p{Alphabetic}\p{Number}_]+/gu) ?? [];
}

function offsetLineGroups(aCount: number, bCount: number): AlignedLineGroup[] {
  const groups: AlignedLineGroup[] = [];
  const count = Math.max(aCount, bCount);
  for (let index = 0; index < count; index += 1) {
    groups.push({
      aFrom: Math.min(index, aCount),
      aTo: Math.min(index + 1, aCount),
      bFrom: Math.min(index, bCount),
      bTo: Math.min(index + 1, bCount),
    });
  }
  return groups;
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
