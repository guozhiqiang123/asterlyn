export interface WordDiffRange {
  readonly fromA: number;
  readonly toA: number;
  readonly fromB: number;
  readonly toB: number;
}

interface Token {
  readonly value: string;
  readonly from: number;
  readonly to: number;
}

const MAX_LCS_CELLS = 65_536;
const COALESCE_GAP = 3;

/** Word-oriented inline differences shared by static and live Diff presentations. */
export function wordDiffRanges(a: string, b: string): WordDiffRange[] | null {
  if (a === b) return [];
  const tokensA = tokenizeDiffWords(a);
  const tokensB = tokenizeDiffWords(b);
  if (tokensA.length * tokensB.length > MAX_LCS_CELLS) return null;

  const columns = tokensB.length + 1;
  const lengths = new Uint32Array((tokensA.length + 1) * columns);
  for (let indexA = tokensA.length - 1; indexA >= 0; indexA -= 1) {
    for (let indexB = tokensB.length - 1; indexB >= 0; indexB -= 1) {
      const cell = indexA * columns + indexB;
      lengths[cell] = tokensA[indexA]!.value === tokensB[indexB]!.value
        ? 1 + lengths[(indexA + 1) * columns + indexB + 1]!
        : Math.max(lengths[(indexA + 1) * columns + indexB]!, lengths[cell + 1]!);
    }
  }

  const matches: Array<{ a: number; b: number }> = [];
  for (let indexA = 0, indexB = 0; indexA < tokensA.length && indexB < tokensB.length;) {
    if (tokensA[indexA]!.value === tokensB[indexB]!.value) {
      matches.push({ a: indexA, b: indexB });
      indexA += 1;
      indexB += 1;
    } else if (lengths[(indexA + 1) * columns + indexB]! >= lengths[indexA * columns + indexB + 1]!) {
      indexA += 1;
    } else {
      indexB += 1;
    }
  }

  const ranges: WordDiffRange[] = [];
  let cursorA = 0;
  let cursorB = 0;
  for (const match of [...matches, { a: tokensA.length, b: tokensB.length }]) {
    if (match.a > cursorA || match.b > cursorB) {
      ranges.push({
        fromA: tokenBoundary(tokensA, cursorA, a.length),
        toA: tokenBoundary(tokensA, match.a, a.length),
        fromB: tokenBoundary(tokensB, cursorB, b.length),
        toB: tokenBoundary(tokensB, match.b, b.length),
      });
    }
    cursorA = match.a + 1;
    cursorB = match.b + 1;
  }
  return coalesceDiffRanges(ranges, a, b);
}

export function tokenizeDiffWords(content: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /[\p{Alphabetic}\p{Number}_]+|\s+|[^\p{Alphabetic}\p{Number}_\s]/gu;
  for (const match of content.matchAll(pattern)) {
    const from = match.index;
    const value = match[0];
    tokens.push({ value, from, to: from + value.length });
  }
  return tokens;
}

export function coalesceDiffRanges(
  ranges: readonly WordDiffRange[],
  a: string,
  b: string,
): WordDiffRange[] {
  const output: WordDiffRange[] = [];
  for (const range of ranges) {
    const previous = output.at(-1);
    if (previous && shouldCoalesce(previous, range, a, b)) {
      output[output.length - 1] = {
        fromA: previous.fromA,
        toA: range.toA,
        fromB: previous.fromB,
        toB: range.toB,
      };
    } else {
      output.push(range);
    }
  }
  return output;
}

function shouldCoalesce(
  left: WordDiffRange,
  right: WordDiffRange,
  a: string,
  b: string,
): boolean {
  const gapA = a.slice(left.toA, right.fromA);
  const gapB = b.slice(left.toB, right.fromB);
  return gapA.length <= COALESCE_GAP && gapB.length <= COALESCE_GAP &&
    /^[\s\p{P}\p{S}]*$/u.test(gapA) && /^[\s\p{P}\p{S}]*$/u.test(gapB);
}

function tokenBoundary(tokens: readonly Token[], index: number, fallback: number): number {
  return tokens[index]?.from ?? fallback;
}
