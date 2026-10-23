import { BlockType, type EditorView } from "@codemirror/view";
import type { DiffReviewRange } from "./diff-review-model.ts";

export interface DiffReviewMeasuredRect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface DiffReviewOverlayFrame {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly pageLeft: number;
  readonly pageTop: number;
}

interface RectBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export function diffReviewOverlayFrame(
  root: RectBounds,
  viewport: RectBounds,
  positioningOrigin: Pick<RectBounds, "left" | "top"> = root,
): DiffReviewOverlayFrame {
  const pageLeft = Math.max(root.left, viewport.left);
  const pageTop = Math.max(root.top, viewport.top);
  const pageRight = Math.min(root.right, viewport.right);
  const pageBottom = Math.min(root.bottom, viewport.bottom);
  return {
    left: pageLeft - positioningOrigin.left,
    top: pageTop - positioningOrigin.top,
    width: Math.max(0, pageRight - pageLeft),
    height: Math.max(0, pageBottom - pageTop),
    pageLeft,
    pageTop,
  };
}

export function measureDiffReviewRange(
  view: EditorView,
  range: DiffReviewRange,
  root: Pick<DOMRect, "left" | "top">,
): DiffReviewMeasuredRect | null {
  const from = Math.min(view.state.doc.length, Math.max(0, range.from));
  const to = Math.min(view.state.doc.length, Math.max(from, range.to));
  const viewport = view.scrollDOM.getBoundingClientRect();
  if (from === to) {
    const bounds = measureEmptyRangeBounds(view, from);
    if (!bounds || bounds.bottom < viewport.top || bounds.top > viewport.bottom) return null;
    return {
      left: viewport.left - root.left,
      right: viewport.right - root.left,
      top: Math.max(bounds.top, viewport.top) - root.top,
      bottom: Math.min(bounds.bottom, viewport.bottom) - root.top,
    };
  }
  // A large changed block may start/end outside CodeMirror's mounted viewport. Its line
  // blocks still have document geometry, so the visible middle of its connector must remain.
  const start = view.coordsAtPos(from, 1) ?? measureLineBlockBounds(view, from);
  const end = view.coordsAtPos(to - 1, -1) ?? measureLineBlockBounds(view, to - 1);
  const top = Math.max(start.top, viewport.top);
  const bottom = Math.min(Math.max(end.bottom, start.bottom), viewport.bottom);
  if (bottom < viewport.top || top > viewport.bottom || bottom <= top) return null;
  return {
    left: viewport.left - root.left,
    right: viewport.right - root.left,
    top: top - root.top,
    bottom: bottom - root.top,
  };
}

export function buildDiffReviewConnectorPath(
  source: DiffReviewMeasuredRect,
  target: DiffReviewMeasuredRect,
): string {
  const sourceTop = Math.min(source.top, source.bottom);
  const sourceBottom = Math.max(sourceTop, source.bottom);
  const targetTop = Math.min(target.top, target.bottom);
  const targetBottom = Math.max(targetTop, target.bottom);
  const startX = source.right;
  const endX = target.left;
  const middleX = startX + (endX - startX) / 2;
  return [
    `M ${number(startX)} ${number(sourceTop)}`,
    `C ${number(middleX)} ${number(sourceTop)} ${number(middleX)} ${number(targetTop)} ${number(endX)} ${number(targetTop)}`,
    `L ${number(endX)} ${number(targetBottom)}`,
    `C ${number(middleX)} ${number(targetBottom)} ${number(middleX)} ${number(sourceBottom)} ${number(startX)} ${number(sourceBottom)}`,
    "Z",
  ].join(" ");
}

function measureEmptyRangeBounds(view: EditorView, position: number): { top: number; bottom: number } | null {
  const line = view.state.doc.lineAt(position);
  const block = view.lineBlockAt(position);
  const parts = Array.isArray(block.type) ? block.type : [block];
  // MergeView already reserves the counterpart's height at an empty range. Paint that
  // alignment slot in the gutter instead of collapsing its edge to a zero-height cusp.
  // Use public block geometry so folding and offscreen spacers do not depend on DOM classes.
  const alignmentHeight = parts.reduce((height, part) => height + (
    part.from === position && part.to === position &&
    (part.type === BlockType.WidgetBefore || part.type === BlockType.WidgetAfter)
      ? part.height : 0
  ), 0);
  let top: number;
  if (position === line.from) {
    top = view.documentTop + (position > 0 ? view.lineBlockAt(position - 1).bottom : block.top);
  } else if (position === line.to) {
    const textBottom = parts.reduce((bottom, part) => part.type === BlockType.Text ? part.bottom : bottom, block.bottom);
    top = view.documentTop + textBottom;
  } else {
    const caret = view.coordsAtPos(position, 1) ?? view.coordsAtPos(position, -1);
    if (!caret) return null;
    top = (caret.top + caret.bottom) / 2;
  }
  return { top, bottom: top + alignmentHeight };
}

function measureLineBlockBounds(view: EditorView, position: number): { top: number; bottom: number } {
  const block = view.lineBlockAt(position);
  const parts = Array.isArray(block.type) ? block.type : [block];
  const text = parts.find((part) => part.type === BlockType.Text && part.from <= position && part.to >= position);
  return {
    top: view.documentTop + (text?.top ?? block.top),
    bottom: view.documentTop + (text?.bottom ?? block.bottom),
  };
}

function number(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}
