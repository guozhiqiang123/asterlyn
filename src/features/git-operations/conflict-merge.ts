import type { GitConflictContent } from "../../models.ts";
import {
  gitConflictMarkerCount,
  projectConflictMarkers,
} from "./conflict-markers.ts";

interface LineEdit {
  readonly from: number;
  readonly to: number;
  readonly replacement: readonly string[];
  readonly side: "ours" | "theirs";
}

interface LineMatch {
  readonly base: number;
  readonly side: number;
}

const MAX_LCS_CELLS = 65_536;

/**
 * Builds the clean Result shown when a conflict is first opened. A marker-free worktree is already
 * a user-authored resolution and always wins. Git's marker document is only an unresolved transport
 * form, so Result is reconstructed from the three indexed stages instead of exposing those markers.
 */
export function initialConflictResult(conflict: GitConflictContent): string {
  if (conflict.worktree !== null && !hasGitConflictMarkers(conflict.worktree)) {
    return conflict.worktree;
  }
  const base = conflict.base ?? "";
  const ours = conflict.ours ?? "";
  const theirs = conflict.theirs ?? "";
  return projectConflictMarkers(base, ours, theirs, conflict.worktree)?.result ??
    threeWayMerge(base, ours, theirs);
}

export function hasGitConflictMarkers(content: string): boolean {
  return gitConflictMarkerCount(content) > 0;
}

/**
 * Conservative line-oriented diff3 merge. Independent edits from both sides are retained. When
 * both sides change the same base region differently, the base region is retained as the neutral
 * editable Result while Ours and Theirs remain available in the adjacent panes.
 */
export function threeWayMerge(base: string, ours: string, theirs: string): string {
  if (ours === theirs) return ours;
  if (ours === base) return theirs;
  if (theirs === base) return ours;

  const baseLines = splitLines(base);
  const oursEdits = lineEdits(baseLines, splitLines(ours), "ours");
  const theirsEdits = lineEdits(baseLines, splitLines(theirs), "theirs");
  const edits = [...oursEdits, ...theirsEdits].sort(compareEdits);
  const output: string[] = [];
  let cursor = 0;

  for (let index = 0; index < edits.length;) {
    const cluster: LineEdit[] = [edits[index]!];
    index += 1;
    for (let changed = true; changed;) {
      changed = false;
      while (index < edits.length && cluster.some((edit) => editsOverlap(edit, edits[index]!))) {
        cluster.push(edits[index]!);
        index += 1;
        changed = true;
      }
    }

    const from = Math.min(...cluster.map((edit) => edit.from));
    const to = Math.max(...cluster.map((edit) => edit.to));
    output.push(...baseLines.slice(cursor, from));
    const baseRegion = baseLines.slice(from, to);
    const oursRegion = applyRegionEdits(baseLines, from, to, cluster.filter((edit) => edit.side === "ours"));
    const theirsRegion = applyRegionEdits(baseLines, from, to, cluster.filter((edit) => edit.side === "theirs"));
    if (equalLines(oursRegion, theirsRegion)) output.push(...oursRegion);
    else if (equalLines(oursRegion, baseRegion)) output.push(...theirsRegion);
    else if (equalLines(theirsRegion, baseRegion)) output.push(...oursRegion);
    else output.push(...baseRegion);
    cursor = to;
  }
  output.push(...baseLines.slice(cursor));
  return output.join("");
}

function lineEdits(
  base: readonly string[],
  side: readonly string[],
  owner: LineEdit["side"],
): LineEdit[] {
  const matches: LineMatch[] = [];
  collectMatches(base, 0, base.length, side, 0, side.length, matches, 0);
  matches.sort((left, right) => left.base - right.base || left.side - right.side);
  const edits: LineEdit[] = [];
  let baseCursor = 0;
  let sideCursor = 0;
  for (const match of matches) {
    if (match.base > baseCursor || match.side > sideCursor) {
      edits.push({
        from: baseCursor,
        to: match.base,
        replacement: side.slice(sideCursor, match.side),
        side: owner,
      });
    }
    baseCursor = match.base + 1;
    sideCursor = match.side + 1;
  }
  if (baseCursor < base.length || sideCursor < side.length) {
    edits.push({
      from: baseCursor,
      to: base.length,
      replacement: side.slice(sideCursor),
      side: owner,
    });
  }
  return edits;
}

function collectMatches(
  base: readonly string[],
  initialBaseFrom: number,
  initialBaseTo: number,
  side: readonly string[],
  initialSideFrom: number,
  initialSideTo: number,
  matches: LineMatch[],
  depth: number,
): void {
  let baseFrom = initialBaseFrom;
  let baseTo = initialBaseTo;
  let sideFrom = initialSideFrom;
  let sideTo = initialSideTo;
  while (baseFrom < baseTo && sideFrom < sideTo && base[baseFrom] === side[sideFrom]) {
    matches.push({ base: baseFrom, side: sideFrom });
    baseFrom += 1;
    sideFrom += 1;
  }
  const suffix: LineMatch[] = [];
  while (baseFrom < baseTo && sideFrom < sideTo && base[baseTo - 1] === side[sideTo - 1]) {
    baseTo -= 1;
    sideTo -= 1;
    suffix.push({ base: baseTo, side: sideTo });
  }
  if (baseFrom < baseTo && sideFrom < sideTo && depth < 64) {
    let anchors = uniqueAnchors(base, baseFrom, baseTo, side, sideFrom, sideTo);
    if (anchors.length === 0 && (baseTo - baseFrom) * (sideTo - sideFrom) <= MAX_LCS_CELLS) {
      anchors = lcsAnchors(base, baseFrom, baseTo, side, sideFrom, sideTo);
    }
    for (const anchor of anchors) {
      collectMatches(base, baseFrom, anchor.base, side, sideFrom, anchor.side, matches, depth + 1);
      matches.push(anchor);
      baseFrom = anchor.base + 1;
      sideFrom = anchor.side + 1;
    }
    if (baseFrom < baseTo && sideFrom < sideTo) {
      collectMatches(base, baseFrom, baseTo, side, sideFrom, sideTo, matches, depth + 1);
    }
  }
  matches.push(...suffix.reverse());
}

function uniqueAnchors(
  base: readonly string[],
  baseFrom: number,
  baseTo: number,
  side: readonly string[],
  sideFrom: number,
  sideTo: number,
): LineMatch[] {
  const baseOccurrences = occurrences(base, baseFrom, baseTo);
  const sideOccurrences = occurrences(side, sideFrom, sideTo);
  const candidates: LineMatch[] = [];
  for (const [line, baseIndexes] of baseOccurrences) {
    const sideIndexes = sideOccurrences.get(line);
    if (baseIndexes.length === 1 && sideIndexes?.length === 1) {
      candidates.push({ base: baseIndexes[0]!, side: sideIndexes[0]! });
    }
  }
  candidates.sort((left, right) => left.base - right.base);
  return longestIncreasingSideSequence(candidates);
}

function occurrences(lines: readonly string[], from: number, to: number): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (let index = from; index < to; index += 1) {
    const line = lines[index]!;
    const indexes = result.get(line) ?? [];
    indexes.push(index);
    result.set(line, indexes);
  }
  return result;
}

function longestIncreasingSideSequence(candidates: readonly LineMatch[]): LineMatch[] {
  if (candidates.length < 2) return [...candidates];
  const previous = new Int32Array(candidates.length);
  previous.fill(-1);
  const tails: number[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (candidates[tails[middle]!]!.side < candidates[index]!.side) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1]!;
    tails[low] = index;
  }
  const result: LineMatch[] = [];
  for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index]!) {
    result.push(candidates[index]!);
    if (previous[index] === -1) break;
  }
  return result.reverse();
}

function lcsAnchors(
  base: readonly string[],
  baseFrom: number,
  baseTo: number,
  side: readonly string[],
  sideFrom: number,
  sideTo: number,
): LineMatch[] {
  const sideCount = sideTo - sideFrom;
  const columns = sideCount + 1;
  const lengths = new Uint32Array((baseTo - baseFrom + 1) * columns);
  for (let baseIndex = baseTo - baseFrom - 1; baseIndex >= 0; baseIndex -= 1) {
    for (let sideIndex = sideCount - 1; sideIndex >= 0; sideIndex -= 1) {
      const cell = baseIndex * columns + sideIndex;
      lengths[cell] = base[baseFrom + baseIndex] === side[sideFrom + sideIndex]
        ? 1 + lengths[(baseIndex + 1) * columns + sideIndex + 1]!
        : Math.max(lengths[(baseIndex + 1) * columns + sideIndex]!, lengths[cell + 1]!);
    }
  }
  const matches: LineMatch[] = [];
  for (let baseIndex = 0, sideIndex = 0; baseIndex < baseTo - baseFrom && sideIndex < sideCount;) {
    if (base[baseFrom + baseIndex] === side[sideFrom + sideIndex]) {
      matches.push({ base: baseFrom + baseIndex, side: sideFrom + sideIndex });
      baseIndex += 1;
      sideIndex += 1;
    } else if (lengths[(baseIndex + 1) * columns + sideIndex]! >= lengths[baseIndex * columns + sideIndex + 1]!) {
      baseIndex += 1;
    } else {
      sideIndex += 1;
    }
  }
  return matches;
}

function editsOverlap(left: LineEdit, right: LineEdit): boolean {
  if (left.from === left.to && right.from === right.to) return left.from === right.from;
  if (left.from === left.to) return left.from >= right.from && left.from <= right.to;
  if (right.from === right.to) return right.from >= left.from && right.from <= left.to;
  return left.from < right.to && right.from < left.to;
}

function applyRegionEdits(
  base: readonly string[],
  from: number,
  to: number,
  edits: readonly LineEdit[],
): string[] {
  if (edits.length === 0) return base.slice(from, to);
  const output: string[] = [];
  let cursor = from;
  for (const edit of [...edits].sort(compareEdits)) {
    output.push(...base.slice(cursor, edit.from), ...edit.replacement);
    cursor = edit.to;
  }
  output.push(...base.slice(cursor, to));
  return output;
}

function compareEdits(left: LineEdit, right: LineEdit): number {
  return left.from - right.from || left.to - right.to || left.side.localeCompare(right.side);
}

function equalLines(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

function splitLines(content: string): string[] {
  if (content.length === 0) return [];
  return content.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/gu) ?? [];
}
