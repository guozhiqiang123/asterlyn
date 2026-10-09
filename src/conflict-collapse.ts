import {
  DiffReviewCollapseCoordinator,
  buildDiffReviewCollapseRanges,
  type DiffReviewCollapseRange,
  type DiffReviewSourceChanges,
} from "./shared/diff-review/diff-review-collapse.ts";

export type ConflictCollapseSide = "ours" | "result" | "theirs";

export class ConflictCollapseCoordinator extends DiffReviewCollapseCoordinator<ConflictCollapseSide> {
  constructor(
    base: string,
    ours: string,
    result: string,
    theirs: string,
    sourceChanges?: DiffReviewSourceChanges<ConflictCollapseSide>,
  ) {
    super(base, { ours, result, theirs }, 3, 8, sourceChanges);
  }
}

export function buildConflictCollapseRanges(
  base: string,
  ours: string,
  result: string,
  theirs: string,
  margin = 3,
  minimumLines = 8,
  sourceChanges?: DiffReviewSourceChanges<ConflictCollapseSide>,
): Readonly<Record<ConflictCollapseSide, readonly DiffReviewCollapseRange[]>> {
  return buildDiffReviewCollapseRanges(
    base,
    { ours, result, theirs },
    margin,
    minimumLines,
    sourceChanges,
  );
}
