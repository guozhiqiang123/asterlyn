import { StateEffect, type Extension, type Range, type Text } from "@codemirror/state";
import { getChunks, getOriginalDoc, mergeViewSiblings, type Change } from "@codemirror/merge";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { lineAwareDiff } from "./features/files-editor/line-aware-diff.ts";

type MergeSide = "a" | "b" | null;
type MergeChunks = NonNullable<ReturnType<typeof getChunks>>["chunks"];
const exactChangeCache = new WeakMap<Text, WeakMap<Text, readonly Change[]>>();
const refreshSemanticHighlighting = StateEffect.define<null>();

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
    // MergeView creates pane A before pane B. Pane A therefore cannot resolve its sibling while
    // its plugins are being constructed. Refresh it once the complete MergeView has been mounted,
    // otherwise only pane B receives the exact intraline decorations.
    if (this.side !== null && !mergeDocuments(view, this.side)) {
      queueMicrotask(() => {
        if (view.dom.isConnected) view.dispatch({ effects: refreshSemanticHighlighting.of(null) });
      });
    }
  }

  update(update: ViewUpdate): void {
    const state = getChunks(update.state);
    const chunks = state?.chunks ?? null;
    const side = state?.side ?? null;
    const refresh = update.transactions.some((transaction) =>
      transaction.effects.some((effect) => effect.is(refreshSemanticHighlighting)),
    );
    if (refresh || update.docChanged || chunks !== this.chunks || side !== this.side) {
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

  const documents = mergeDocuments(view, merge.side);
  if (documents) for (const change of exactChanges(documents.a, documents.b)) {
    const oldChanged = change.toA > change.fromA;
    const newChanged = change.toB > change.fromB;
    const kind = oldChanged && newChanged
      ? "modified"
      : merge.side === "a"
        ? "removed"
        : "added";
    const from = merge.side === "a" ? change.fromA : change.fromB;
    const to = merge.side === "a" ? change.toA : change.toB;
    if (kind === "modified") addModifiedLines(doc, from, to, ranges);
    addInlineRanges(doc, from, to, `cm-source-word-${kind}`, ranges);
  }

  return Decoration.set(ranges, true);
}

function mergeDocuments(
  view: EditorView,
  side: MergeSide,
): { a: Text; b: Text } | null {
  if (side !== null) {
    const siblings = mergeViewSiblings(view);
    return siblings?.a && siblings.b
      ? { a: siblings.a.state.doc, b: siblings.b.state.doc }
      : null;
  }
  return { a: getOriginalDoc(view.state), b: view.state.doc };
}

function exactChanges(a: Text, b: Text): readonly Change[] {
  let byAfter = exactChangeCache.get(a);
  if (!byAfter) exactChangeCache.set(a, byAfter = new WeakMap());
  let changes = byAfter.get(b);
  if (!changes) {
    changes = lineAwareDiff(a.toString(), b.toString());
    byAfter.set(b, changes);
  }
  return changes;
}

function addModifiedLines(
  doc: Text,
  from: number,
  to: number,
  ranges: Array<Range<Decoration>>,
): void {
  if (from >= to || from > doc.length) return;
  const firstLine = doc.lineAt(Math.min(from, doc.length)).number;
  const lastLine = doc.lineAt(Math.min(to - 1, doc.length)).number;
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
