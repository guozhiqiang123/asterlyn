import type { EditorView } from "@codemirror/view";
import type { DiffReviewPaneId, DiffReviewSnapshot } from "./diff-review-model.ts";
import {
  buildDiffReviewConnectorPath,
  diffReviewOverlayFrame,
  measureDiffReviewRange,
} from "./diff-review-geometry.ts";
import { DiffReviewViewportIndex } from "./diff-review-viewport.ts";

export interface DiffReviewOverlayConnection {
  readonly from: DiffReviewPaneId;
  readonly to: DiffReviewPaneId;
}

export class DiffReviewOverlay {
  private readonly svg: SVGSVGElement;
  private snapshot: DiffReviewSnapshot | null = null;
  private index = new DiffReviewViewportIndex([]);
  private readonly paths = new Map<string, SVGPathElement>();
  private frame: number | null = null;
  private readonly disposers: Array<() => void> = [];
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly root: HTMLElement,
    private readonly views: Readonly<Partial<Record<DiffReviewPaneId, EditorView>>>,
    private readonly connections: readonly DiffReviewOverlayConnection[],
    private readonly viewport: HTMLElement = root,
  ) {
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.classList.add("diff-review-overlay");
    this.svg.setAttribute("aria-hidden", "true");
    root.append(this.svg);
    const listener = () => this.schedule();
    root.addEventListener("scroll", listener, { passive: true, capture: true });
    this.disposers.push(() => root.removeEventListener("scroll", listener, true));
    this.resizeObserver = new ResizeObserver(() => this.schedule());
    this.resizeObserver.observe(root);
    if (viewport !== root) this.resizeObserver.observe(viewport);
    for (const view of Object.values(views)) if (view) this.resizeObserver.observe(view.scrollDOM);
  }

  setSnapshot(snapshot: DiffReviewSnapshot): void {
    this.snapshot = snapshot;
    this.index = new DiffReviewViewportIndex(snapshot.blocks);
    this.schedule();
  }

  schedule(): void {
    if (this.frame !== null) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      this.render();
    });
  }

  destroy(): void {
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.resizeObserver.disconnect();
    for (const dispose of this.disposers.splice(0)) dispose();
    this.svg.remove();
    this.paths.clear();
  }

  private render(): void {
    const snapshot = this.snapshot;
    if (!snapshot || !this.root.isConnected) return;
    const root = this.root.getBoundingClientRect();
    // DOM rectangles start at the border box; absolute children start at the padding box
    // and move with the containing block's scroll offset. Keep clipping in page coordinates.
    const frame = diffReviewOverlayFrame(root, this.viewport.getBoundingClientRect(), {
      left: root.left + this.root.clientLeft - this.root.scrollLeft,
      top: root.top + this.root.clientTop - this.root.scrollTop,
    });
    if (frame.width <= 0 || frame.height <= 0) {
      this.svg.replaceChildren();
      this.paths.clear();
      this.svg.style.display = "none";
      return;
    }
    const projected: Array<{ key: string; path: string; className: string; blockId: string }> = [];
    for (const connection of this.connections) {
      const fromView = this.views[connection.from];
      const toView = this.views[connection.to];
      if (!fromView || !toView) continue;
      const candidates = new Set([
        ...this.index.intersecting(connection.from, fromView.viewport.from, fromView.viewport.to),
        ...this.index.intersecting(connection.to, toView.viewport.from, toView.viewport.to),
      ]);
      for (const block of candidates) {
        const fromRange = block.ranges[connection.from];
        const toRange = block.ranges[connection.to];
        if (!fromRange || !toRange) continue;
        const origin = { left: frame.pageLeft, top: frame.pageTop };
        const source = measureDiffReviewRange(fromView, fromRange, origin);
        const target = measureDiffReviewRange(toView, toRange, origin);
        if (!source || !target) continue;
        projected.push({
          key: `${connection.from}:${connection.to}:${block.id}`,
          path: buildDiffReviewConnectorPath(source, target),
          className: ["diff-review-connector", `diff-review-connector-${block.status}`,
            block.id === snapshot.activeBlockId ? "is-active" : ""].filter(Boolean).join(" "),
          blockId: block.id,
        });
      }
    }
    this.svg.style.removeProperty("display");
    this.svg.style.left = `${frame.left}px`;
    this.svg.style.top = `${frame.top}px`;
    this.svg.style.width = `${frame.width}px`;
    this.svg.style.height = `${frame.height}px`;
    this.svg.setAttribute("viewBox", `0 0 ${frame.width} ${frame.height}`);
    const shown = new Set<string>();
    for (const item of projected) {
      shown.add(item.key);
      let path = this.paths.get(item.key);
      if (!path) {
        path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.dataset.blockId = item.blockId;
        this.paths.set(item.key, path);
        this.svg.append(path);
      }
      if (path.getAttribute("d") !== item.path) path.setAttribute("d", item.path);
      if (path.getAttribute("class") !== item.className) path.setAttribute("class", item.className);
    }
    for (const [key, path] of this.paths) {
      if (shown.has(key)) continue;
      path.remove();
      this.paths.delete(key);
    }
  }
}
