import type { EditorView } from "@codemirror/view";
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
): DiffReviewOverlayFrame {
  const pageLeft = Math.max(root.left, viewport.left);
  const pageTop = Math.max(root.top, viewport.top);
  const pageRight = Math.min(root.right, viewport.right);
  const pageBottom = Math.min(root.bottom, viewport.bottom);
  return {
    left: pageLeft - root.left,
    top: pageTop - root.top,
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
  const start = view.coordsAtPos(from, 1);
  const end = view.coordsAtPos(to > from ? to - 1 : from, -1);
  if (!start || !end) return null;
  const viewport = view.scrollDOM.getBoundingClientRect();
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
  const sourceBottom = Math.max(sourceTop + 2, source.bottom);
  const targetTop = Math.min(target.top, target.bottom);
  const targetBottom = Math.max(targetTop + 2, target.bottom);
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

function number(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}
