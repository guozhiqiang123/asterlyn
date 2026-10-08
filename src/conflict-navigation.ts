import type { ConflictResolutionBlockSnapshot } from "./conflict-resolution-model.ts";

export interface ConflictNavigationTarget {
  readonly index: number;
  readonly position: number;
}

/** Finds the adjacent two-sided conflict, skipping ordinary and identical changes. */
export function adjacentConflictTarget(
  blocks: readonly ConflictResolutionBlockSnapshot[],
  activeIndex: number,
  direction: 1 | -1,
): ConflictNavigationTarget | null {
  const isConflict = (block: ConflictResolutionBlockSnapshot): boolean =>
    block.oursChanged && block.theirsChanged && !block.sameSideContent;

  if (direction === 1) {
    for (let index = Math.max(0, activeIndex + 1); index < blocks.length; index += 1) {
      const block = blocks[index]!;
      if (isConflict(block)) return { index, position: block.result.from };
    }
    return null;
  }

  const start = activeIndex < 0 ? blocks.length - 1 : activeIndex - 1;
  for (let index = start; index >= 0; index -= 1) {
    const block = blocks[index]!;
    if (isConflict(block)) return { index, position: block.result.from };
  }
  return null;
}
