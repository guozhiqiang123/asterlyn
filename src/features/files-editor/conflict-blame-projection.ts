import type { GitBlameHunk, GitBlameResult } from "../../models.ts";
import { lineAwareDiff } from "../../shared/diff-review/line-aware-diff.ts";

export interface ConflictBlameSourceResult {
  readonly text: string;
  readonly blame: GitBlameResult;
}

interface LineSpan {
  readonly number: number;
  readonly from: number;
  readonly to: number;
  readonly fullTo: number;
  readonly text: string;
}

/**
 * Projects exact, unchanged source lines into the editable conflict Result.
 * Changed, ambiguous, or synthesized Result lines deliberately remain local.
 */
export function projectConflictResultBlame(
  path: string,
  result: string,
  sources: readonly ConflictBlameSourceResult[],
): GitBlameResult {
  const resultLines = lineSpans(result);
  const projections = sources.map((source) => ({
    source,
    lines: unchangedLineProjection(source.text, result),
    hunks: [...source.blame.hunks].sort((left, right) => left.finalStartLine - right.finalStartLine),
  }));
  const lines = resultLines.map((line) => {
    const candidates = projections.flatMap(({ source, lines: mapping, hunks }) => {
      const sourceLine = mapping.get(line.number);
      if (sourceLine === undefined) return [];
      const hunk = blameHunkAt(hunks, sourceLine);
      if (!hunk) return [];
      return [{ hunk, sourceLine, revision: source.blame.revision }];
    });
    if (candidates.length === 0) return localLine(line.number);
    const first = candidates[0]!;
    if (candidates.some((candidate) => !sameAttribution(first.hunk, candidate.hunk))) {
      return localLine(line.number);
    }
    return {
      ...first.hunk,
      originalStartLine: first.hunk.originalStartLine + first.sourceLine - first.hunk.finalStartLine,
      finalStartLine: line.number,
      lineCount: 1,
    };
  });
  return {
    repositoryId: sources[0]?.blame.repositoryId ?? ".",
    path,
    revision: null,
    hunks: compactLines(lines),
    truncated: sources.some((source) => source.blame.truncated),
  };
}

function unchangedLineProjection(source: string, result: string): Map<number, number> {
  const sourceLines = lineSpans(source);
  const resultLines = lineSpans(result);
  const sourceByFrom = new Map(sourceLines.map((line) => [line.from, line]));
  const mapping = new Map<number, number>();
  let sourceCursor = 0;
  let resultCursor = 0;
  for (const change of [...lineAwareDiff(source, result), null]) {
    const sourceTo = change?.fromA ?? source.length;
    const resultTo = change?.fromB ?? result.length;
    for (const resultLine of resultLines) {
      if (resultLine.from < resultCursor || resultLine.fullTo > resultTo) continue;
      const sourceFrom = sourceCursor + resultLine.from - resultCursor;
      const sourceLine = sourceByFrom.get(sourceFrom);
      if (
        sourceLine &&
        sourceLine.fullTo <= sourceTo &&
        sourceLine.text === resultLine.text
      ) {
        mapping.set(resultLine.number, sourceLine.number);
      }
    }
    if (!change) break;
    sourceCursor = change.toA;
    resultCursor = change.toB;
  }
  return mapping;
}

function lineSpans(text: string): LineSpan[] {
  const lines: LineSpan[] = [];
  let from = 0;
  let number = 1;
  while (from <= text.length) {
    const newline = text.indexOf("\n", from);
    const to = newline < 0 ? text.length : newline;
    lines.push({
      number,
      from,
      to,
      fullTo: newline < 0 ? to : to + 1,
      text: text.slice(from, to),
    });
    if (newline < 0) break;
    from = newline + 1;
    number += 1;
  }
  return lines;
}

function blameHunkAt(hunks: readonly GitBlameHunk[], line: number): GitBlameHunk | null {
  let low = 0;
  let high = hunks.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const hunk = hunks[middle]!;
    if (line < hunk.finalStartLine) high = middle - 1;
    else if (line >= hunk.finalStartLine + hunk.lineCount) low = middle + 1;
    else return hunk;
  }
  return null;
}

function sameAttribution(left: GitBlameHunk, right: GitBlameHunk): boolean {
  return left.oid === right.oid &&
    left.authorName === right.authorName &&
    left.authorEmail === right.authorEmail &&
    left.authoredAt === right.authoredAt &&
    left.summary === right.summary &&
    left.uncommitted === right.uncommitted;
}

function localLine(line: number): GitBlameHunk {
  return {
    oid: "0000000000000000000000000000000000000000",
    originalStartLine: line,
    finalStartLine: line,
    lineCount: 1,
    authorName: "",
    authorEmail: "",
    authoredAt: 0,
    summary: "",
    uncommitted: true,
  };
}

function compactLines(lines: readonly GitBlameHunk[]): GitBlameHunk[] {
  const compacted: GitBlameHunk[] = [];
  for (const line of lines) {
    const previous = compacted.at(-1);
    if (
      previous &&
      sameAttribution(previous, line) &&
      previous.finalStartLine + previous.lineCount === line.finalStartLine &&
      previous.originalStartLine + previous.lineCount === line.originalStartLine
    ) {
      previous.lineCount += 1;
    } else {
      compacted.push({ ...line });
    }
  }
  return compacted;
}
