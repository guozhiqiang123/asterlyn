export type DiffLayout = "unified" | "split";

export interface DiffPresentation {
  layout: DiffLayout;
  showWhitespace: boolean;
  splitPercentage?: number;
  onSplitPercentageChange?: (value: number, committed: boolean) => void;
}

export interface TextRange {
  from: number;
  to: number;
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

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

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
  const count = Math.max(removed.length, added.length);
  for (let offset = 0; offset < count; offset += 1) {
    const oldText = removed[offset];
    const newText = added[offset];
    const paired = oldText !== undefined && newText !== undefined;
    const changed = paired ? intralineRanges(oldText, newText) : null;
    rows.push(
      row(
        paired ? "modified" : oldText !== undefined ? "removed" : "added",
        side(
          oldText === undefined ? null : oldStart + offset,
          oldText ?? "",
          changed?.old,
        ),
        side(
          newText === undefined ? null : newStart + offset,
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

function intralineRanges(
  oldText: string,
  newText: string,
): { old: TextRange[]; new: TextRange[] } {
  if (oldText === newText || oldText.length > 500 || newText.length > 500) {
    return { old: [], new: [] };
  }
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
  if (prefix === 0 && suffix === 0) return { old: [], new: [] };
  return {
    old:
      oldText.length - suffix > prefix
        ? [{ from: prefix, to: oldText.length - suffix }]
        : [],
    new:
      newText.length - suffix > prefix
        ? [{ from: prefix, to: newText.length - suffix }]
        : [],
  };
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
