import { ChangeSet } from "@codemirror/state";
import type { Change } from "@codemirror/merge";
import { lineAwareDiff } from "../../shared/diff-review/line-aware-diff.ts";

export interface ConflictMarkerRange {
  readonly from: number;
  readonly to: number;
}

export interface ProjectedConflictMarker {
  readonly base: ConflictMarkerRange;
  readonly ours: ConflictMarkerRange;
  readonly theirs: ConflictMarkerRange;
  readonly result: ConflictMarkerRange;
}

export interface ConflictMarkerProjection {
  readonly result: string;
  readonly blocks: readonly ProjectedConflictMarker[];
}

interface ParsedConflict {
  readonly oursText: string;
  readonly baseText: string | null;
  readonly theirsText: string;
}

type ParsedPart =
  | { readonly kind: "common"; readonly text: string }
  | { readonly kind: "conflict"; readonly index: number };

interface ParsedMarkerDocument {
  readonly conflicts: readonly ParsedConflict[];
  readonly parts: readonly ParsedPart[];
}

interface SideProjection {
  readonly text: string;
  readonly ranges: readonly ConflictMarkerRange[];
}

/** Returns the number of complete Git marker groups, ignoring marker-like standalone text. */
export function gitConflictMarkerCount(content: string | null): number {
  if (content === null) return 0;
  return parseMarkerDocument(content)?.conflicts.length ?? 0;
}

/**
 * Rebuilds Git's auto-merged marker document as a clean Result and records the exact unresolved
 * payload ranges in Ours, Result, and Theirs. This is intentionally separate from the general
 * Base diff: Git's marker groups are authoritative when repeated lines make insertion anchors
 * ambiguous.
 */
export function projectConflictMarkers(
  base: string,
  ours: string,
  theirs: string,
  worktree: string | null,
): ConflictMarkerProjection | null {
  if (worktree === null) return null;
  const parsed = parseMarkerDocument(worktree);
  if (!parsed) return null;

  const oursProjection = buildSideProjection(parsed, "ours");
  const theirsProjection = buildSideProjection(parsed, "theirs");
  const oursRanges = mapPayloadRanges(oursProjection, ours);
  const theirsRanges = mapPayloadRanges(theirsProjection, theirs);
  if (!oursRanges || !theirsRanges) return null;

  const oursChanges = lineAwareDiff(base, ours);
  const theirsChanges = lineAwareDiff(base, theirs);
  const baseRanges: ConflictMarkerRange[] = [];
  const fallbackTexts: string[] = [];
  for (let index = 0; index < parsed.conflicts.length; index += 1) {
    const conflict = parsed.conflicts[index]!;
    const relevant = [
      ...changesTouchingSourceRange(oursChanges, oursRanges[index]!),
      ...changesTouchingSourceRange(theirsChanges, theirsRanges[index]!),
    ];
    const allInsertions = relevant.length > 0 && relevant.every((change) => change.fromA === change.toA);
    const from = relevant.length > 0 ? Math.min(...relevant.map((change) => change.fromA)) : 0;
    const to = relevant.length > 0 ? Math.max(...relevant.map((change) => change.toA)) : from;
    const baseRange = allInsertions ? { from, to: from } : expandToWholeLines(base, { from, to });
    baseRanges.push(baseRange);
    fallbackTexts.push(conflict.baseText ?? (allInsertions
      ? ""
      : base.slice(baseRange.from, baseRange.to)));
  }

  let result = "";
  const resultRanges: ConflictMarkerRange[] = [];
  for (const part of parsed.parts) {
    if (part.kind === "common") {
      result += part.text;
      continue;
    }
    const from = result.length;
    result += fallbackTexts[part.index]!;
    resultRanges[part.index] = { from, to: result.length };
  }
  return {
    result,
    blocks: parsed.conflicts.map((_, index) => ({
      base: baseRanges[index]!,
      ours: oursRanges[index]!,
      theirs: theirsRanges[index]!,
      result: resultRanges[index]!,
    })),
  };
}

function parseMarkerDocument(content: string): ParsedMarkerDocument | null {
  const lines = indexedLines(content);
  const conflicts: ParsedConflict[] = [];
  const parts: ParsedPart[] = [];
  let commonFrom = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const opening = markerLength(lines[index]!.text, "<", true);
    if (opening === null) continue;
    const openLine = lines[index]!;
    const oursFrom = openLine.to;
    let oursTo = -1;
    let baseFrom = -1;
    let baseTo = -1;
    let theirsFrom = -1;
    let closingIndex = -1;
    let nestedOpeningIndex = -1;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor]!;
      if (markerLength(line.text, "<", true) !== null) {
        nestedOpeningIndex = cursor;
        break;
      }
      if (baseFrom < 0 && markerLength(line.text, "|", true) === opening) {
        oursTo = line.from;
        baseFrom = line.to;
        continue;
      }
      if (theirsFrom < 0 && markerLength(line.text, "=", false) === opening) {
        if (oursTo < 0) oursTo = line.from;
        if (baseFrom >= 0) baseTo = line.from;
        theirsFrom = line.to;
        continue;
      }
      if (theirsFrom >= 0 && markerLength(line.text, ">", true) === opening) {
        closingIndex = cursor;
        break;
      }
    }
    if (nestedOpeningIndex >= 0) {
      index = nestedOpeningIndex - 1;
      continue;
    }
    if (oursTo < 0 || theirsFrom < 0 || closingIndex < 0) continue;
    const closing = lines[closingIndex]!;
    if (openLine.from > commonFrom) {
      parts.push({ kind: "common", text: content.slice(commonFrom, openLine.from) });
    }
    const conflictIndex = conflicts.length;
    conflicts.push({
      oursText: content.slice(oursFrom, oursTo),
      baseText: baseFrom >= 0 ? content.slice(baseFrom, baseTo) : null,
      theirsText: content.slice(theirsFrom, closing.from),
    });
    parts.push({ kind: "conflict", index: conflictIndex });
    commonFrom = closing.to;
    index = closingIndex;
  }
  if (conflicts.length === 0) return null;
  if (commonFrom < content.length) parts.push({ kind: "common", text: content.slice(commonFrom) });
  return { conflicts, parts };
}

function buildSideProjection(
  parsed: ParsedMarkerDocument,
  side: "ours" | "theirs",
): SideProjection {
  let text = "";
  const ranges: ConflictMarkerRange[] = [];
  for (const part of parsed.parts) {
    if (part.kind === "common") {
      text += part.text;
      continue;
    }
    const from = text.length;
    text += side === "ours"
      ? parsed.conflicts[part.index]!.oursText
      : parsed.conflicts[part.index]!.theirsText;
    ranges[part.index] = { from, to: text.length };
  }
  return { text, ranges };
}

function mapPayloadRanges(
  projection: SideProjection,
  document: string,
): readonly ConflictMarkerRange[] | null {
  const changes = lineAwareDiff(projection.text, document);
  const mapping = ChangeSet.of(changes.map((change) => ({
    from: change.fromA,
    to: change.toA,
    insert: document.slice(change.fromB, change.toB),
  })), projection.text.length).desc;
  const ranges: ConflictMarkerRange[] = [];
  let cursor = 0;
  for (const source of projection.ranges) {
    const payload = projection.text.slice(source.from, source.to);
    const mapped = {
      from: mapping.mapPos(source.from, -1),
      to: mapping.mapPos(source.to, 1),
    };
    let range = mapped;
    if (payload.length > 0 && (mapped.from < cursor || document.slice(mapped.from, mapped.to) !== payload)) {
      const exact = document.indexOf(payload, cursor);
      if (exact < 0) return null;
      range = { from: exact, to: exact + payload.length };
    } else if (payload.length === 0) {
      const position = Math.max(cursor, Math.min(document.length, mapped.from));
      range = { from: position, to: position };
    }
    ranges.push(range);
    cursor = range.to;
  }
  return ranges;
}

function changesTouchingSourceRange(
  changes: readonly Change[],
  source: ConflictMarkerRange,
): readonly Change[] {
  return changes.filter((change) => rangesTouch(
    { from: change.fromB, to: change.toB },
    source,
  ));
}

function rangesTouch(left: ConflictMarkerRange, right: ConflictMarkerRange): boolean {
  if (left.from === left.to && right.from === right.to) return left.from === right.from;
  if (left.from === left.to) return right.from <= left.from && left.from <= right.to;
  if (right.from === right.to) return left.from <= right.from && right.from <= left.to;
  return left.from < right.to && right.from < left.to;
}

function expandToWholeLines(content: string, range: ConflictMarkerRange): ConflictMarkerRange {
  let from = range.from;
  while (from > 0 && content[from - 1] !== "\n" && content[from - 1] !== "\r") from -= 1;
  let to = range.to;
  if (to > from && (content[to - 1] === "\n" || content[to - 1] === "\r")) return { from, to };
  while (to < content.length && content[to] !== "\n" && content[to] !== "\r") to += 1;
  if (content[to] === "\r") to += content[to + 1] === "\n" ? 2 : 1;
  else if (content[to] === "\n") to += 1;
  return { from, to };
}

function markerLength(line: string, character: "<" | "|" | "=" | ">", suffix: boolean): number | null {
  const body = line.replace(/(?:\r\n|\r|\n)$/u, "");
  const escaped = character === "|" ? "\\|" : character;
  const match = new RegExp(`^(${escaped}{7,})${suffix ? "(?: .*)?" : ""}$`, "u").exec(body);
  return match?.[1]?.length ?? null;
}

function indexedLines(content: string): readonly { readonly text: string; readonly from: number; readonly to: number }[] {
  const result: { text: string; from: number; to: number }[] = [];
  const pattern = /[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/gu;
  for (const match of content.matchAll(pattern)) {
    const from = match.index;
    result.push({ text: match[0], from, to: from + match[0].length });
  }
  return result;
}
