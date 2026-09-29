import { presentableDiff } from "@codemirror/merge";

export type DiffLayout = "unified" | "split";

export interface DiffPresentation {
  layout: DiffLayout;
  showWhitespace: boolean;
  splitPercentage?: number;
  onSplitPercentageChange?: (value: number, committed: boolean) => void;
}

export type InlineChangeKind = "added" | "removed" | "modified";

export interface TextRange {
  from: number;
  to: number;
  kind: InlineChangeKind;
}

export type SourceDiffRowKind =
  | "context"
  | "added"
  | "removed"
  | "modified"
  | "omitted"
  | "notice";

export interface SourceDiffSide {
  lineNumber: number | null;
  text: string;
  changed: TextRange[];
}

export interface SourceDiffRow {
  kind: SourceDiffRowKind;
  old: SourceDiffSide;
  new: SourceDiffSide;
}

export interface SplitDiffDocument {
  oldDocument: string;
  newDocument: string;
  rows: SourceDiffRow[];
}

export interface UnifiedDiffRow {
  kind: "context" | "added" | "removed" | "omitted" | "notice";
  oldLineNumber: number | null;
  newLineNumber: number | null;
  text: string;
  changed?: TextRange[];
}

export interface UnifiedDiffDocument {
  document: string;
  rows: UnifiedDiffRow[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const INLINE_DIFF_CONFIG = { scanLimit: 1_000, timeout: 50 } as const;
const MAX_LINE_ALIGNMENT_CELLS = 4_096;
const ALIGNMENT_GAP_SCORE = -0.45;

export function parseUnifiedDiff(document: string): UnifiedDiffDocument {
  const lines = document.split("\n");
  const rows: UnifiedDiffRow[] = [];
  let index = 0;
  let oldLine = 0;
  let newLine = 0;
  let sawHunk = false;

  while (index < lines.length) {
    const header = HUNK_HEADER.exec(lines[index] ?? "");
    if (!header) {
      index += 1;
      continue;
    }

    const nextOldLine = Number(header[1]);
    const nextNewLine = Number(header[3]);
    const oldCount = Math.max(0, nextOldLine - (sawHunk ? oldLine : 1));
    const newCount = Math.max(0, nextNewLine - (sawHunk ? newLine : 1));
    if (oldCount > 0 || newCount > 0) {
      const label =
        oldCount === newCount
          ? `⋯ ${oldCount} unchanged ${oldCount === 1 ? "line" : "lines"} omitted ⋯`
          : `⋯ ${oldCount} old / ${newCount} new lines omitted ⋯`;
      rows.push({
        kind: "omitted",
        oldLineNumber: null,
        newLineNumber: null,
        text: label,
      });
    }
    sawHunk = true;
    oldLine = nextOldLine;
    newLine = nextNewLine;
    index += 1;

    while (index < lines.length && !HUNK_HEADER.test(lines[index] ?? "")) {
      const line = lines[index] ?? "";
      if (line.startsWith("diff --git ")) break;
      if (line.startsWith("-")) {
        const removed: string[] = [];
        const added: string[] = [];
        while (index < lines.length && (lines[index] ?? "").startsWith("-")) {
          removed.push((lines[index] ?? "").slice(1));
          index += 1;
        }
        while (index < lines.length && (lines[index] ?? "").startsWith("+")) {
          added.push((lines[index] ?? "").slice(1));
          index += 1;
        }
        const oldRanges: TextRange[][] = removed.map(() => []);
        const newRanges: TextRange[][] = added.map(() => []);
        for (const pair of alignChangedLines(removed, added)) {
          if (pair.oldIndex === null || pair.newIndex === null) continue;
          const changed = pairedTextChangeRanges(
            removed[pair.oldIndex] ?? "",
            added[pair.newIndex] ?? "",
          );
          oldRanges[pair.oldIndex] = changed.old;
          newRanges[pair.newIndex] = changed.new;
        }
        for (let i = 0; i < removed.length; i += 1) {
          rows.push({
            kind: "removed",
            oldLineNumber: oldLine + i,
            newLineNumber: null,
            text: removed[i] ?? "",
            changed: oldRanges[i],
          });
        }
        oldLine += removed.length;
        for (let i = 0; i < added.length; i += 1) {
          rows.push({
            kind: "added",
            oldLineNumber: null,
            newLineNumber: newLine + i,
            text: added[i] ?? "",
            changed: newRanges[i],
          });
        }
        newLine += added.length;
        continue;
      }
      if (line.startsWith("+")) {
        while (index < lines.length && (lines[index] ?? "").startsWith("+")) {
          rows.push({
            kind: "added",
            oldLineNumber: null,
            newLineNumber: newLine,
            text: (lines[index] ?? "").slice(1),
          });
          newLine += 1;
          index += 1;
        }
        continue;
      }
      if (line.startsWith(" ")) {
        rows.push({
          kind: "context",
          oldLineNumber: oldLine,
          newLineNumber: newLine,
          text: line.slice(1),
        });
        oldLine += 1;
        newLine += 1;
        index += 1;
        continue;
      }
      if (isNoNewlineMarker(line)) {
        index += 1;
        continue;
      }
      if (line.startsWith("[Diff truncated")) {
        rows.push({
          kind: "notice",
          oldLineNumber: null,
          newLineNumber: null,
          text: line,
        });
      }
      index += 1;
    }
  }

  if (!sawHunk) {
    const documentLines = document.split("\n");
    const notice =
      documentLines.find((line) => line.startsWith("Binary file")) ??
      documentLines.find((line) => line.startsWith("[Diff truncated")) ??
      "No textual changes in the bounded patch";
    rows.push({
      kind: "notice",
      oldLineNumber: null,
      newLineNumber: null,
      text: notice,
    });
  }

  return {
    document: rows.map((r) => r.text).join("\n"),
    rows,
  };
}

export function splitUnifiedDiff(document: string): SplitDiffDocument {
  const lines = document.split("\n");
  const rows: SourceDiffRow[] = [];
  let index = 0;
  let oldLine = 0;
  let newLine = 0;
  let sawHunk = false;
  let lastChangeSide: "old" | "new" | null = null;

  while (index < lines.length) {
    const header = HUNK_HEADER.exec(lines[index] ?? "");
    if (!header) {
      index += 1;
      continue;
    }

    const nextOldLine = Number(header[1]);
    const nextNewLine = Number(header[3]);
    appendOmittedRow(rows, oldLine, newLine, nextOldLine, nextNewLine, sawHunk);
    sawHunk = true;
    oldLine = nextOldLine;
    newLine = nextNewLine;
    index += 1;

    while (index < lines.length && !HUNK_HEADER.test(lines[index] ?? "")) {
      const line = lines[index] ?? "";
      if (line.startsWith("diff --git ")) break;
      if (line.startsWith("-")) {
        const removed: string[] = [];
        const added: string[] = [];
        while (index < lines.length && (lines[index] ?? "").startsWith("-")) {
          removed.push((lines[index] ?? "").slice(1));
          index += 1;
        }
        const oldMarker = isNoNewlineMarker(lines[index] ?? "")
          ? (lines[index++] ?? "")
          : null;
        while (index < lines.length && (lines[index] ?? "").startsWith("+")) {
          added.push((lines[index] ?? "").slice(1));
          index += 1;
        }
        const newMarker = isNoNewlineMarker(lines[index] ?? "")
          ? (lines[index++] ?? "")
          : null;
        const consumed = appendChangedRows(rows, removed, added, oldLine, newLine);
        oldLine += consumed.oldCount;
        newLine += consumed.newCount;
        appendNoNewlineRows(rows, oldMarker, newMarker);
        lastChangeSide = added.length > 0 ? "new" : "old";
        continue;
      }
      if (line.startsWith("+")) {
        const added: string[] = [];
        while (index < lines.length && (lines[index] ?? "").startsWith("+")) {
          added.push((lines[index] ?? "").slice(1));
          index += 1;
        }
        const newMarker = isNoNewlineMarker(lines[index] ?? "")
          ? (lines[index++] ?? "")
          : null;
        const consumed = appendChangedRows(rows, [], added, oldLine, newLine);
        oldLine += consumed.oldCount;
        newLine += consumed.newCount;
        appendNoNewlineRows(rows, null, newMarker);
        lastChangeSide = "new";
        continue;
      }
      if (line.startsWith(" ")) {
        rows.push(
          row(
            "context",
            side(oldLine, line.slice(1)),
            side(newLine, line.slice(1)),
          ),
        );
        oldLine += 1;
        newLine += 1;
        lastChangeSide = null;
        index += 1;
        continue;
      }
      if (isNoNewlineMarker(line)) {
        appendNoNewlineRows(
          rows,
          lastChangeSide === "old" ? line : null,
          lastChangeSide === "new" ? line : null,
        );
        index += 1;
        continue;
      }
      if (line.startsWith("[Diff truncated")) {
        rows.push(row("notice", side(null, line), side(null, line)));
      }
      index += 1;
    }
  }

  if (!sawHunk) {
    const documentLines = document.split("\n");
    const notice =
      documentLines.find((line) => line.startsWith("Binary file")) ??
      documentLines.find((line) => line.startsWith("[Diff truncated")) ??
      "No textual changes in the bounded patch";
    rows.push(
      row(
        "notice",
        side(null, notice ?? "No textual changes"),
        side(null, notice ?? "No textual changes"),
      ),
    );
  }

  return {
    oldDocument: rows.map((item) => item.old.text).join("\n"),
    newDocument: rows.map((item) => item.new.text).join("\n"),
    rows,
  };
}

function appendOmittedRow(
  rows: SourceDiffRow[],
  previousOldLine: number,
  previousNewLine: number,
  nextOldLine: number,
  nextNewLine: number,
  sawHunk: boolean,
): void {
  const oldCount = Math.max(0, nextOldLine - (sawHunk ? previousOldLine : 1));
  const newCount = Math.max(0, nextNewLine - (sawHunk ? previousNewLine : 1));
  if (oldCount === 0 && newCount === 0) return;
  const label =
    oldCount === newCount
      ? `⋯ ${oldCount} unchanged ${oldCount === 1 ? "line" : "lines"} omitted ⋯`
      : `⋯ ${oldCount} old / ${newCount} new lines omitted ⋯`;
  rows.push(row("omitted", side(null, label), side(null, label)));
}

function appendChangedRows(
  rows: SourceDiffRow[],
  removed: string[],
  added: string[],
  oldStart: number,
  newStart: number,
): { oldCount: number; newCount: number } {
  for (const pair of alignChangedLines(removed, added)) {
    const oldText = pair.oldIndex === null ? undefined : removed[pair.oldIndex];
    const newText = pair.newIndex === null ? undefined : added[pair.newIndex];
    const paired = oldText !== undefined && newText !== undefined;
    const changed = paired ? pairedTextChangeRanges(oldText, newText) : null;
    rows.push(
      row(
        paired ? "modified" : oldText !== undefined ? "removed" : "added",
        side(
          oldText === undefined || pair.oldIndex === null
            ? null
            : oldStart + pair.oldIndex,
          oldText ?? "",
          changed?.old,
        ),
        side(
          newText === undefined || pair.newIndex === null
            ? null
            : newStart + pair.newIndex,
          newText ?? "",
          changed?.new,
        ),
      ),
    );
  }
  return { oldCount: removed.length, newCount: added.length };
}

function appendNoNewlineRows(
  rows: SourceDiffRow[],
  oldMarker: string | null,
  newMarker: string | null,
): void {
  if (!oldMarker && !newMarker) return;
  const label = "No newline at end of file";
  rows.push(
    row(
      "notice",
      side(null, oldMarker ? label : ""),
      side(null, newMarker ? label : ""),
    ),
  );
}

export function pairedTextChangeRanges(
  oldText: string,
  newText: string,
): { old: TextRange[]; new: TextRange[] } {
  if (oldText === newText) return { old: [], new: [] };
  const old: TextRange[] = [];
  const next: TextRange[] = [];
  for (const change of presentableDiff(oldText, newText, INLINE_DIFF_CONFIG)) {
    const hasOld = change.toA > change.fromA;
    const hasNew = change.toB > change.fromB;
    const kind: InlineChangeKind = hasOld && hasNew
      ? "modified"
      : hasOld
        ? "removed"
        : "added";
    if (hasOld) old.push({ from: change.fromA, to: change.toA, kind });
    if (hasNew) next.push({ from: change.fromB, to: change.toB, kind });
  }
  return { old, new: next };
}

interface ChangedLinePair {
  oldIndex: number | null;
  newIndex: number | null;
}

function alignChangedLines(removed: string[], added: string[]): ChangedLinePair[] {
  if (removed.length === 0) {
    return added.map((_, newIndex) => ({ oldIndex: null, newIndex }));
  }
  if (added.length === 0) {
    return removed.map((_, oldIndex) => ({ oldIndex, newIndex: null }));
  }
  if (removed.length * added.length > MAX_LINE_ALIGNMENT_CELLS) {
    return offsetLinePairs(removed.length, added.length);
  }

  const columns = added.length + 1;
  const scores = new Float64Array((removed.length + 1) * columns);
  const directions = new Uint8Array(scores.length);
  for (let oldIndex = 1; oldIndex <= removed.length; oldIndex += 1) {
    scores[oldIndex * columns] = oldIndex * ALIGNMENT_GAP_SCORE;
    directions[oldIndex * columns] = 2;
  }
  for (let newIndex = 1; newIndex <= added.length; newIndex += 1) {
    scores[newIndex] = newIndex * ALIGNMENT_GAP_SCORE;
    directions[newIndex] = 3;
  }

  for (let oldIndex = 1; oldIndex <= removed.length; oldIndex += 1) {
    for (let newIndex = 1; newIndex <= added.length; newIndex += 1) {
      const cell = oldIndex * columns + newIndex;
      let best = (scores[(oldIndex - 1) * columns + newIndex - 1] ?? Number.NEGATIVE_INFINITY)
        + linePairScore(removed[oldIndex - 1] ?? "", added[newIndex - 1] ?? "");
      let direction = 1;
      const oldOnly = (scores[(oldIndex - 1) * columns + newIndex] ?? Number.NEGATIVE_INFINITY)
        + ALIGNMENT_GAP_SCORE;
      if (oldOnly > best) {
        best = oldOnly;
        direction = 2;
      }
      const newOnly = (scores[oldIndex * columns + newIndex - 1] ?? Number.NEGATIVE_INFINITY)
        + ALIGNMENT_GAP_SCORE;
      if (newOnly > best) {
        best = newOnly;
        direction = 3;
      }
      scores[cell] = best;
      directions[cell] = direction;
    }
  }

  const pairs: ChangedLinePair[] = [];
  let oldIndex = removed.length;
  let newIndex = added.length;
  while (oldIndex > 0 || newIndex > 0) {
    const direction = directions[oldIndex * columns + newIndex];
    if (direction === 1) {
      pairs.push({ oldIndex: oldIndex - 1, newIndex: newIndex - 1 });
      oldIndex -= 1;
      newIndex -= 1;
    } else if (direction === 2) {
      pairs.push({ oldIndex: oldIndex - 1, newIndex: null });
      oldIndex -= 1;
    } else {
      pairs.push({ oldIndex: null, newIndex: newIndex - 1 });
      newIndex -= 1;
    }
  }
  return pairs.reverse();
}

function offsetLinePairs(oldCount: number, newCount: number): ChangedLinePair[] {
  const pairs: ChangedLinePair[] = [];
  const count = Math.max(oldCount, newCount);
  for (let index = 0; index < count; index += 1) {
    pairs.push({
      oldIndex: index < oldCount ? index : null,
      newIndex: index < newCount ? index : null,
    });
  }
  return pairs;
}

function linePairScore(oldText: string, newText: string): number {
  if (oldText === newText) return 1.3;
  const oldTokens = lineTokens(oldText);
  const newTokens = lineTokens(newText);
  const counts = new Map<string, number>();
  for (const token of oldTokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  let overlap = 0;
  for (const token of newTokens) {
    const available = counts.get(token) ?? 0;
    if (available <= 0) continue;
    overlap += 1;
    counts.set(token, available - 1);
  }
  const tokenSimilarity = oldTokens.length + newTokens.length === 0
    ? 0
    : (2 * overlap) / (oldTokens.length + newTokens.length);

  let prefix = 0;
  const prefixLimit = Math.min(oldText.length, newText.length);
  while (prefix < prefixLimit && oldText[prefix] === newText[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldText.length - prefix &&
    suffix < newText.length - prefix &&
    oldText[oldText.length - suffix - 1] === newText[newText.length - suffix - 1]
  ) {
    suffix += 1;
  }
  const totalLength = oldText.length + newText.length;
  const edgeSimilarity = totalLength === 0 ? 1 : (2 * (prefix + suffix)) / totalLength;
  const longest = Math.max(oldText.length, newText.length);
  const lengthSimilarity = longest === 0
    ? 1
    : 1 - Math.abs(oldText.length - newText.length) / longest;
  const similarity = 0.65 * tokenSimilarity + 0.25 * edgeSimilarity + 0.1 * lengthSimilarity;
  return 2 * similarity - 0.7;
}

function lineTokens(text: string): string[] {
  return text.match(/[\p{Alphabetic}\p{Number}_]+|[^\s]/gu) ?? [];
}

function row(
  kind: SourceDiffRowKind,
  oldSide: SourceDiffSide,
  newSide: SourceDiffSide,
): SourceDiffRow {
  return { kind, old: oldSide, new: newSide };
}

function side(
  lineNumber: number | null,
  text: string,
  changed: TextRange[] = [],
): SourceDiffSide {
  return { lineNumber, text, changed };
}

function isNoNewlineMarker(line: string): boolean {
  return line === "\\ No newline at end of file";
}
