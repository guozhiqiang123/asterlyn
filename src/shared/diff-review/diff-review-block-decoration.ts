import { StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { DiffReviewBlockStatus } from "./diff-review-model.ts";

export interface DiffReviewBlockDecoration {
  readonly from: number;
  readonly to: number;
  readonly status: DiffReviewBlockStatus;
  readonly active: boolean;
}

export const setDiffReviewBlockDecorations = StateEffect.define<readonly DiffReviewBlockDecoration[]>();

export const diffReviewBlockDecorations = StateField.define({
  create: () => Decoration.none,
  update: (decorations, transaction) => {
    const update = transaction.effects.find((effect) => effect.is(setDiffReviewBlockDecorations));
    if (!update) return decorations.map(transaction.changes);
    const ranges: Array<Range<Decoration>> = [];
    for (const block of update.value) {
      const from = Math.min(transaction.newDoc.length, Math.max(0, block.from));
      const to = Math.min(transaction.newDoc.length, Math.max(from, block.to));
      const first = transaction.newDoc.lineAt(from).number;
      const lastPosition = to > from ? to - 1 : from;
      const last = transaction.newDoc.lineAt(lastPosition).number;
      for (let lineNumber = first; lineNumber <= last; lineNumber += 1) {
        const line = transaction.newDoc.line(lineNumber);
        ranges.push(Decoration.line({
          class: [
            "cm-diff-review-block",
            `cm-diff-review-${block.status}`,
            block.active ? "cm-diff-review-active" : "",
            lineNumber === first ? "cm-diff-review-block-start" : "",
            lineNumber === last ? "cm-diff-review-block-end" : "",
          ].filter(Boolean).join(" "),
        }).range(line.from));
      }
    }
    return Decoration.set(ranges, true);
  },
  provide: (field) => EditorView.decorations.from(field),
});
