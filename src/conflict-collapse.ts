import {
  DiffReviewCollapseCoordinator,
  buildDiffReviewCollapseRanges,
  type DiffReviewCollapseRange,
} from "./shared/diff-review/diff-review-collapse.ts";

export type ConflictCollapseSide = "ours" | "result" | "theirs";

export class ConflictCollapseCoordinator extends DiffReviewCollapseCoordinator<ConflictCollapseSide> {
  constructor(base: string, ours: string, result: string, theirs: string) {
    super(base, { ours, result, theirs });
  }
}

export function buildConflictCollapseRanges(
  base: string,
  ours: string,
  result: string,
  theirs: string,
  margin = 3,
  minimumLines = 8,
): Readonly<Record<ConflictCollapseSide, readonly DiffReviewCollapseRange[]>> {
  return buildDiffReviewCollapseRanges(base, { ours, result, theirs }, margin, minimumLines);
}
