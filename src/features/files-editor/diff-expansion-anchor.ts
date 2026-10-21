import { EditorView } from "@codemirror/view";

export interface DiffExpansionAnchor {
  section: string;
  side: "old" | "new" | "unified";
  viewportOffset: number;
  scrollLeft: number;
}

export interface DiffExpansionBinding {
  view: EditorView;
  side: "old" | "new" | null;
  sourceLine(documentLine: number): number | null;
}

export interface DiffScrollSnapshot {
  topRatio: number;
  scrollTop: number;
  left: number;
}

export function restoreDiffScroll(
  scroll: DiffScrollSnapshot,
  preserveExact: boolean,
  views: readonly EditorView[],
  active: () => boolean,
): void {
  let attempts = 0;
  const apply = () => {
    if (!active() || views.length === 0) return;
    for (const view of views) {
      const dom = view.scrollDOM;
      const max = Math.max(0, dom.scrollHeight - dom.clientHeight);
      if (max > 0 || attempts >= 5) {
        dom.scrollTop = preserveExact ? Math.min(max, scroll.scrollTop) : max * scroll.topRatio;
      } else {
        dom.scrollTop = scroll.scrollTop;
      }
      dom.scrollLeft = preserveExact ? scroll.left : 0;
    }
    const first = views[0]?.scrollDOM;
    if (first && preserveExact && first.scrollTop < scroll.scrollTop && attempts < 5) {
      attempts += 1;
      window.requestAnimationFrame(apply);
    }
  };
  apply();
  window.requestAnimationFrame(apply);
}

export function captureDiffExpansionAnchor(
  view: EditorView,
  section: string,
  side: "old" | "new" | null,
  omitted: Element,
): DiffExpansionAnchor {
  return {
    section,
    side: side ?? "unified",
    viewportOffset: omitted.getBoundingClientRect().top -
      view.scrollDOM.getBoundingClientRect().top,
    scrollLeft: view.scrollDOM.scrollLeft,
  };
}

export function restoreDiffExpansionAnchor(
  anchor: DiffExpansionAnchor,
  bindings: readonly DiffExpansionBinding[],
  views: readonly EditorView[],
  active: () => boolean,
): boolean {
  const [oldFrom, , newFrom] = anchor.section.split(":").map(Number);
  const preferredSide = anchor.side === "unified" ? null : anchor.side;
  const binding = bindings.find((candidate) => candidate.side === preferredSide) ??
    bindings.find((candidate) => candidate.side === "new") ?? bindings[0];
  const sourceLine = binding?.side === "old" ? oldFrom : newFrom;
  if (!binding || !Number.isFinite(sourceLine)) return false;
  let documentLine = 0;
  for (let line = 1; line <= binding.view.state.doc.lines; line += 1) {
    if (binding.sourceLine(line) === sourceLine) {
      documentLine = line;
      break;
    }
  }
  if (documentLine === 0) return false;
  const line = binding.view.state.doc.line(documentLine);
  binding.view.dispatch({
    effects: EditorView.scrollIntoView(line.from, { y: "center" }),
  });
  let attempts = 0;
  const align = () => {
    if (!active() || !views.includes(binding.view)) return;
    const coordinates = binding.view.coordsAtPos(line.from);
    if (coordinates) {
      const viewportTop = binding.view.scrollDOM.getBoundingClientRect().top;
      binding.view.scrollDOM.scrollTop +=
        coordinates.top - viewportTop - anchor.viewportOffset;
    }
    binding.view.scrollDOM.scrollLeft = anchor.scrollLeft;
    if (attempts < 2) {
      attempts += 1;
      window.requestAnimationFrame(align);
    }
  };
  window.requestAnimationFrame(align);
  return true;
}
