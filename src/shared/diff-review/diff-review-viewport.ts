import type { DiffReviewBlock, DiffReviewPaneId } from "./diff-review-model.ts";

interface Entry {
  readonly block: DiffReviewBlock;
  readonly from: number;
  readonly to: number;
  readonly end: number;
}

/** Index document intervals once per snapshot; scrolling only visits intersecting blocks. */
export class DiffReviewViewportIndex {
  private readonly panes = new Map<DiffReviewPaneId, readonly Entry[]>();

  constructor(blocks: readonly DiffReviewBlock[]) {
    const entries = new Map<DiffReviewPaneId, Array<Omit<Entry, "end">>>();
    for (const block of blocks) {
      for (const pane of Object.keys(block.ranges) as DiffReviewPaneId[]) {
        const range = block.ranges[pane];
        if (!range) continue;
        const list = entries.get(pane) ?? [];
        list.push({ block, from: range.from, to: range.to });
        entries.set(pane, list);
      }
    }
    for (const [pane, list] of entries) {
      list.sort((a, b) => a.from - b.from);
      let end = -1;
      this.panes.set(pane, list.map((entry) => ({ ...entry, end: end = Math.max(end, entry.to) })));
    }
  }

  intersecting(pane: DiffReviewPaneId, from: number, to: number): readonly DiffReviewBlock[] {
    const entries = this.panes.get(pane) ?? [];
    let low = 0, high = entries.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (entries[middle]!.end < from) low = middle + 1;
      else high = middle;
    }
    const blocks: DiffReviewBlock[] = [];
    for (let index = low; index < entries.length; index++) {
      const entry = entries[index]!;
      if (entry.from > to) break;
      if (entry.to >= from) blocks.push(entry.block);
    }
    return blocks;
  }
}
