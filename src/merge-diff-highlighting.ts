import type { Extension, Range, Text } from "@codemirror/state";
import { getChunks } from "@codemirror/merge";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

type MergeSide = "a" | "b" | null;
type MergeChunks = NonNullable<ReturnType<typeof getChunks>>["chunks"];

/**
 * Paint Asterlyn's semantic line and inline layers on CodeMirror's live Diff chunks.
 * CodeMirror remains the single owner of chunk calculation and editing behavior.
 */
export const mergeDiffSemanticHighlighting: Extension = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  private chunks: MergeChunks | null;
  private side: MergeSide;

  constructor(view: EditorView) {
    const state = getChunks(view.state);
    this.chunks = state?.chunks ?? null;
    this.side = state?.side ?? null;
    this.decorations = buildDecorations(view);
  }

  update(update: ViewUpdate): void {
    const state = getChunks(update.state);
    const chunks = state?.chunks ?? null;
    const side = state?.side ?? null;
    if (update.docChanged || chunks !== this.chunks || side !== this.side) {
      this.chunks = chunks;
      this.side = side;
      this.decorations = buildDecorations(update.view);
    }
  }
}, {
  decorations: (plugin) => plugin.decorations,
});

function buildDecorations(view: EditorView): DecorationSet {
  const merge = getChunks(view.state);
  if (!merge) return Decoration.none;
  const ranges: Array<Range<Decoration>> = [];
  const doc = view.state.doc;

  for (const chunk of merge.chunks) {
    const hasA = chunk.toA > chunk.fromA;
    const hasB = chunk.toB > chunk.fromB;
    if (!hasA || !hasB) continue;

    if (merge.side === "a" || merge.side === "b") {
      const from = merge.side === "a" ? chunk.fromA : chunk.fromB;
      const end = merge.side === "a" ? chunk.endA : chunk.endB;
      addModifiedLines(doc, from, end, ranges);
    }

    for (const change of chunk.changes) {
      const oldChanged = change.toA > change.fromA;
      const newChanged = change.toB > change.fromB;
      const kind = merge.side === null
        ? "added"
        : oldChanged && newChanged
          ? "modified"
          : merge.side === "a"
            ? "removed"
            : "added";
      const from = merge.side === "a"
        ? chunk.fromA + change.fromA
        : chunk.fromB + change.fromB;
      const to = merge.side === "a"
        ? chunk.fromA + change.toA
        : chunk.fromB + change.toB;
      addInlineRanges(doc, from, to, `cm-source-word-${kind}`, ranges);
    }
  }

  return Decoration.set(ranges, true);
}

function addModifiedLines(
  doc: Text,
  from: number,
  end: number,
  ranges: Array<Range<Decoration>>,
): void {
  if (from > doc.length || end < from) return;
  const firstLine = doc.lineAt(Math.min(from, doc.length)).number;
  const lastLine = doc.lineAt(Math.min(end, doc.length)).number;
  for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
    ranges.push(
      Decoration.line({ class: "cm-source-modified" }).range(doc.line(lineNumber).from),
    );
  }
}

function addInlineRanges(
  doc: Text,
  rawFrom: number,
  rawTo: number,
  className: string,
  ranges: Array<Range<Decoration>>,
): void {
  const from = Math.max(0, Math.min(doc.length, rawFrom));
  const to = Math.max(from, Math.min(doc.length, rawTo));
  for (let position = from; position < to;) {
    const line = doc.lineAt(position);
    const lineEnd = Math.min(to, line.to);
    if (position < lineEnd) {
      ranges.push(Decoration.mark({ class: className }).range(position, lineEnd));
    }
    if (lineEnd >= to) break;
    position = line.to + 1;
  }
}
