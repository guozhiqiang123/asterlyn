import { ChangeSet } from "@codemirror/state";
import type { Change } from "@codemirror/merge";
import { lineStructuralDiff } from "./shared/diff-review/line-aware-diff.ts";
import type { TextChange } from "./features/files-editor/text-content.ts";
import { projectConflictMarkers } from "./features/git-operations/conflict-markers.ts";

export type ConflictResolutionSide = "ours" | "theirs";
export type ConflictResolutionDecision = "pending" | "accepted" | "ignored";
export interface ConflictSourceRange {
  readonly from: number;
  readonly to: number;
}

export interface ConflictResolutionBlockSnapshot {
  readonly id: number;
  readonly base: ConflictSourceRange;
  readonly ours: ConflictSourceRange;
  readonly theirs: ConflictSourceRange;
  readonly result: ConflictSourceRange;
  readonly oursDecision: ConflictResolutionDecision;
  readonly theirsDecision: ConflictResolutionDecision;
  readonly oursChanged: boolean;
  readonly theirsChanged: boolean;
  readonly sameSideContent: boolean;
  readonly automaticallyResolved: boolean;
  readonly manuallyEdited: boolean;
  readonly markerBacked?: boolean;
}

export interface ConflictResolutionHistoryState {
  readonly blocks: readonly {
    readonly id: number;
    readonly fallbackText: string;
    readonly oursDecision: ConflictResolutionDecision;
    readonly theirsDecision: ConflictResolutionDecision;
    readonly automaticallyResolved: boolean;
    readonly manuallyEdited: boolean;
  }[];
}

export interface ConflictResolutionAnalysis {
  readonly ours: readonly Change[];
  readonly result: readonly Change[];
  readonly theirs: readonly Change[];
}

export function analyzeConflictResolution(
  base: string,
  ours: string,
  result: string,
  theirs: string,
): ConflictResolutionAnalysis {
  return {
    ours: lineStructuralDiff(base, ours),
    result: lineStructuralDiff(base, result),
    theirs: lineStructuralDiff(base, theirs),
  };
}

interface TaggedChange {
  readonly side: ConflictResolutionSide;
  readonly change: Change;
}

interface ConflictResolutionBlock {
  readonly id: number;
  readonly base: ConflictSourceRange;
  readonly ours: ConflictSourceRange;
  readonly theirs: ConflictSourceRange;
  result: ConflictSourceRange;
  readonly oursText: string;
  readonly theirsText: string;
  fallbackText: string;
  readonly oursChanged: boolean;
  readonly theirsChanged: boolean;
  automaticallyResolved: boolean;
  oursDecision: ConflictResolutionDecision;
  theirsDecision: ConflictResolutionDecision;
  manuallyEdited: boolean;
  readonly markerBacked: boolean;
}

/**
 * Owns the transient decisions behind the conflict editor's Apply/Ignore controls.
 *
 * The side documents never change, so every action is anchored to a Base range. Result ranges are
 * mapped through every edit. This makes accepting both sides deterministic even after an earlier
 * block changed the length of Result.
 */
export class ConflictResolutionModel {
  private readonly blocks: ConflictResolutionBlock[];

  private constructor(blocks: ConflictResolutionBlock[]) {
    this.blocks = blocks;
  }

  static create(
    base: string,
    ours: string,
    theirs: string,
    result: string,
    worktree: string | null = null,
    analysis: ConflictResolutionAnalysis = analyzeConflictResolution(base, ours, result, theirs),
  ): ConflictResolutionModel {
    const oursChanges = analysis.ours;
    const theirsChanges = analysis.theirs;
    const resultChanges = analysis.result;
    const oursMapping = changeMapping(base.length, ours, oursChanges);
    const theirsMapping = changeMapping(base.length, theirs, theirsChanges);
    const resultMapping = changeMapping(base.length, result, resultChanges);
    const markerProjection = projectConflictMarkers(base, ours, theirs, worktree, {
      ours: oursChanges,
      theirs: theirsChanges,
    });
    const clusters = clusterChanges([
      ...oursChanges.map((change) => ({ side: "ours" as const, change })),
      ...theirsChanges.map((change) => ({ side: "theirs" as const, change })),
    ]).filter((cluster) => !markerProjection?.blocks.some((marker) =>
      cluster.some(({ side, change }) => rangesTouch(
        { from: change.fromB, to: change.toB },
        marker[side],
      )),
    ));

    const blocks: Array<Omit<ConflictResolutionBlock, "id">> = clusters.map((cluster) => {
      const baseFrom = Math.min(...cluster.map(({ change }) => change.fromA));
      const baseTo = Math.max(...cluster.map(({ change }) => change.toA));
      const oursRange = mappedRange(oursMapping, baseFrom, baseTo);
      const theirsRange = mappedRange(theirsMapping, baseFrom, baseTo);
      const resultRange = mappedRange(resultMapping, baseFrom, baseTo);
      const oursText = ours.slice(oursRange.from, oursRange.to);
      const theirsText = theirs.slice(theirsRange.from, theirsRange.to);
      const fallbackText = result.slice(resultRange.from, resultRange.to);
      const oursChanged = cluster.some(({ side }) => side === "ours");
      const theirsChanged = cluster.some(({ side }) => side === "theirs");
      const sameSideContent = oursText === theirsText;
      const automaticallyResolved = (!oursChanged && theirsChanged && fallbackText === theirsText) ||
        (oursChanged && !theirsChanged && fallbackText === oursText) ||
        (oursChanged && theirsChanged && sameSideContent && fallbackText === oursText);
      return {
        base: { from: baseFrom, to: baseTo },
        ours: oursRange,
        theirs: theirsRange,
        result: resultRange,
        oursText,
        theirsText,
        fallbackText,
        oursChanged,
        theirsChanged,
        automaticallyResolved,
        oursDecision: "pending",
        theirsDecision: "pending",
        manuallyEdited: false,
        markerBacked: false,
      };
    });
    if (markerProjection) {
      const markerResultMapping = changeMapping(
        markerProjection.result.length,
        result,
        lineStructuralDiff(markerProjection.result, result),
      );
      for (const marker of markerProjection.blocks) {
        const resultRange = mappedRange(markerResultMapping, marker.result.from, marker.result.to);
        blocks.push({
          base: marker.base,
          ours: marker.ours,
          theirs: marker.theirs,
          result: resultRange,
          oursText: ours.slice(marker.ours.from, marker.ours.to),
          theirsText: theirs.slice(marker.theirs.from, marker.theirs.to),
          fallbackText: result.slice(resultRange.from, resultRange.to),
          oursChanged: true,
          theirsChanged: true,
          automaticallyResolved: false,
          oursDecision: "pending",
          theirsDecision: "pending",
          manuallyEdited: false,
          markerBacked: true,
        });
      }
    }
    blocks.sort((left, right) =>
      left.result.from - right.result.from || left.base.from - right.base.from,
    );
    return new ConflictResolutionModel(blocks.map((block, id) => ({ id, ...block })));
  }

  snapshots(): readonly ConflictResolutionBlockSnapshot[] {
    return this.blocks.map((block) => ({
      id: block.id,
      base: { ...block.base },
      ours: { ...block.ours },
      theirs: { ...block.theirs },
      result: { ...block.result },
      oursDecision: block.oursDecision,
      theirsDecision: block.theirsDecision,
      oursChanged: block.oursChanged,
      theirsChanged: block.theirsChanged,
      sameSideContent: block.oursText === block.theirsText,
      automaticallyResolved: block.automaticallyResolved,
      manuallyEdited: block.manuallyEdited,
      markerBacked: block.markerBacked,
    }));
  }

  historyState(): ConflictResolutionHistoryState {
    return { blocks: this.blocks.map((block) => ({
      id: block.id,
      fallbackText: block.fallbackText,
      oursDecision: block.oursDecision,
      theirsDecision: block.theirsDecision,
      automaticallyResolved: block.automaticallyResolved,
      manuallyEdited: block.manuallyEdited,
    })) };
  }

  restoreHistoryState(state: ConflictResolutionHistoryState): boolean {
    if (!this.historyStateMatches(state)) return false;
    for (const saved of state.blocks) {
      const block = this.blocks[saved.id]!;
      block.fallbackText = saved.fallbackText;
      block.oursDecision = saved.oursDecision;
      block.theirsDecision = saved.theirsDecision;
      block.automaticallyResolved = saved.automaticallyResolved;
      block.manuallyEdited = saved.manuallyEdited;
    }
    return true;
  }

  observeHistoryChanges(
    changes: readonly TextChange[],
    resultLengthBefore: number,
    state: ConflictResolutionHistoryState,
  ): boolean {
    if (!this.historyStateMatches(state)) return false;
    this.mapResultRanges(changes, resultLengthBefore);
    return this.restoreHistoryState(state);
  }

  hasChanges(side: ConflictResolutionSide, source: ConflictSourceRange): boolean {
    return this.matchingBlocks(side, source).length > 0;
  }

  decision(
    side: ConflictResolutionSide,
    source: ConflictSourceRange,
  ): ConflictResolutionDecision | "mixed" | null {
    const matching = this.matchingBlocks(side, source);
    if (matching.length === 0) return null;
    const first = decisionForSide(matching[0]!, side);
    return matching.every((block) => decisionForSide(block, side) === first) ? first : "mixed";
  }

  applyDecision(
    side: ConflictResolutionSide,
    decision: Exclude<ConflictResolutionDecision, "pending">,
    source: ConflictSourceRange,
    currentResult: string,
  ): readonly TextChange[] {
    const matching = this.matchingBlocks(side, source);
    if (matching.length === 0) return [];
    for (const block of matching) {
      setDecisionForSide(block, side, decision);
      block.manuallyEdited = false;
    }

    const changes = matching
      .map((block): TextChange | null => {
        const insert = resolvedBlockText(block);
        const current = currentResult.slice(block.result.from, block.result.to);
        return current === insert ? null : { from: block.result.from, to: block.result.to, insert };
      })
      .filter((change): change is TextChange => change !== null)
      .sort((left, right) => left.from - right.from || left.to - right.to);
    this.mapResultRanges(changes, currentResult.length);
    return changes;
  }

  observeManualChanges(
    changes: readonly TextChange[],
    resultLengthBefore: number,
    resultAfter: string,
  ): void {
    if (changes.length === 0) return;
    const touched = new Set(this.blocks.filter((block) =>
      changes.some((change) => rangesTouch(block.result, change)),
    ));
    this.mapResultRanges(changes, resultLengthBefore);
    for (const block of touched) {
      block.oursDecision = "pending";
      block.theirsDecision = "pending";
      block.fallbackText = resultAfter.slice(block.result.from, block.result.to);
      block.automaticallyResolved = false;
      block.manuallyEdited = true;
    }
  }

  private matchingBlocks(
    side: ConflictResolutionSide,
    source: ConflictSourceRange,
  ): ConflictResolutionBlock[] {
    return this.blocks.filter((block) => {
      if (side === "ours" ? !block.oursChanged : !block.theirsChanged) return false;
      return rangesTouch(block[side], source);
    });
  }

  private historyStateMatches(state: ConflictResolutionHistoryState): boolean {
    return state.blocks.length === this.blocks.length &&
      state.blocks.every((saved, index) => saved.id === index);
  }

  private mapResultRanges(changes: readonly TextChange[], documentLength: number): void {
    if (changes.length === 0) return;
    const mapping = ChangeSet.of(changes, documentLength).desc;
    for (const block of this.blocks) {
      block.result = mappedRange(mapping, block.result.from, block.result.to);
    }
  }
}

function decisionForSide(
  block: ConflictResolutionBlock,
  side: ConflictResolutionSide,
): ConflictResolutionDecision {
  return side === "ours" ? block.oursDecision : block.theirsDecision;
}

function setDecisionForSide(
  block: ConflictResolutionBlock,
  side: ConflictResolutionSide,
  decision: Exclude<ConflictResolutionDecision, "pending">,
): void {
  if (side === "ours") block.oursDecision = decision;
  else block.theirsDecision = decision;
}

function resolvedBlockText(block: ConflictResolutionBlock): string {
  const ours = block.oursDecision === "accepted";
  const theirs = block.theirsDecision === "accepted";
  if (ours && theirs) return combineSides(block.oursText, block.theirsText);
  if (ours) return block.oursText;
  if (theirs) return block.theirsText;
  return block.fallbackText;
}

function combineSides(ours: string, theirs: string): string {
  if (ours === theirs) return ours;
  if (ours.length === 0) return theirs;
  if (theirs.length === 0) return ours;
  const separator = ours.endsWith("\n") || theirs.startsWith("\n") ? "" : "\n";
  return `${ours}${separator}${theirs}`;
}

function changeMapping(baseLength: number, side: string, changes: readonly Change[]) {
  return ChangeSet.of(changes.map((change) => ({
    from: change.fromA,
    to: change.toA,
    insert: side.slice(change.fromB, change.toB),
  })), baseLength).desc;
}

function mappedRange(
  mapping: Pick<ReturnType<typeof changeMapping>, "mapPos">,
  from: number,
  to: number,
): ConflictSourceRange {
  return {
    from: mapping.mapPos(from, -1),
    to: mapping.mapPos(to, 1),
  };
}

function clusterChanges(changes: readonly TaggedChange[]): TaggedChange[][] {
  const ordered = [...changes].sort((left, right) =>
    left.change.fromA - right.change.fromA ||
    left.change.toA - right.change.toA ||
    left.side.localeCompare(right.side),
  );
  const clusters: TaggedChange[][] = [];
  for (const tagged of ordered) {
    const matching = clusters.filter((cluster) =>
      cluster.some(({ change }) => baseChangesOverlap(change, tagged.change)),
    );
    if (matching.length === 0) {
      clusters.push([tagged]);
      continue;
    }
    const target = matching[0]!;
    target.push(tagged);
    for (const extra of matching.slice(1)) {
      target.push(...extra);
      clusters.splice(clusters.indexOf(extra), 1);
    }
  }
  return clusters.sort((left, right) => left[0]!.change.fromA - right[0]!.change.fromA);
}

function baseChangesOverlap(left: Change, right: Change): boolean {
  if (left.fromA === left.toA && right.fromA === right.toA) return left.fromA === right.fromA;
  if (left.fromA === left.toA) return right.fromA <= left.fromA && left.fromA <= right.toA;
  if (right.fromA === right.toA) return left.fromA <= right.fromA && right.fromA <= left.toA;
  return left.fromA < right.toA && right.fromA < left.toA;
}

function rangesTouch(
  left: ConflictSourceRange,
  right: ConflictSourceRange,
): boolean {
  if (left.from === left.to && right.from === right.to) return left.from === right.from;
  if (left.from === left.to) return right.from <= left.from && left.from <= right.to;
  if (right.from === right.to) return left.from <= right.from && right.from <= left.to;
  return left.from < right.to && right.from < left.to;
}
