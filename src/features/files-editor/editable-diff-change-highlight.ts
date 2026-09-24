import { StateEffect, StateField, type Range, type Text } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { DiffChangeBlock } from "./diff-navigation.ts";

export const setActiveEditableDiffBlock = StateEffect.define<DiffChangeBlock | null>();

// Use the same per-line decoration classes as the read-only Diff used by Push.
export const activeEditableDiffBlockDecoration = StateField.define({
  create: () => Decoration.none,
  update: (decorations, transaction) => {
    const active = transaction.effects.find((effect) => effect.is(setActiveEditableDiffBlock));
    if (!active) return decorations.map(transaction.changes);
    const block = active.value;
    if (block === null || block.fromLine > transaction.newDoc.lines) return Decoration.none;
    const fromLine = Math.max(1, block.fromLine);
    const toLine = Math.min(transaction.newDoc.lines, block.toLine);
    const ranges: Array<Range<Decoration>> = [];
    for (let lineNumber = fromLine; lineNumber <= toLine; lineNumber += 1) {
      const line = transaction.newDoc.line(lineNumber);
      const classes = [
        "cm-diff-current-change",
        lineNumber === fromLine ? "cm-diff-current-change-start" : "",
        lineNumber === toLine ? "cm-diff-current-change-end" : "",
      ].filter(Boolean).join(" ");
      ranges.push(Decoration.line({ class: classes }).range(line.from));
    }
    return Decoration.set(ranges, true);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function diffBlockFromOffsets(doc: Text, from: number, to: number): DiffChangeBlock | null {
  if (to <= from) return null;
  const start = doc.lineAt(Math.min(from, doc.length)).number;
  const end = doc.lineAt(Math.max(from, Math.min(to - 1, Math.max(0, doc.length - 1)))).number;
  return { fromLine: start, toLine: end };
}
