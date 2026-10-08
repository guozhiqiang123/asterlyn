import type { EditorView } from "@codemirror/view";
import type { DiffReviewPaneId, DiffReviewSnapshot } from "./diff-review-model.ts";
import { buildDiffReviewConnectorPath, measureDiffReviewRange } from "./diff-review-geometry.ts";

export interface DiffReviewOverlayConnection {
  readonly from: DiffReviewPaneId;
  readonly to: DiffReviewPaneId;
}

export class DiffReviewOverlay {
  private readonly svg: SVGSVGElement;
  private snapshot: DiffReviewSnapshot | null = null;
  private frame: number | null = null;
  private readonly disposers: Array<() => void> = [];
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly root: HTMLElement,
    private readonly views: Readonly<Partial<Record<DiffReviewPaneId, EditorView>>>,
    private readonly connections: readonly DiffReviewOverlayConnection[],
  ) {
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.classList.add("diff-review-overlay");
    this.svg.setAttribute("aria-hidden", "true");
    root.append(this.svg);
    const scrollElements = new Set(
      Object.values(views).filter((view): view is EditorView => Boolean(view)).map((view) => view.scrollDOM),
    );
    for (const element of scrollElements) {
      const listener = () => this.schedule();
      element.addEventListener("scroll", listener, { passive: true });
      this.disposers.push(() => element.removeEventListener("scroll", listener));
    }
    this.resizeObserver = new ResizeObserver(() => this.schedule());
    this.resizeObserver.observe(root);
    for (const view of Object.values(views)) if (view) this.resizeObserver.observe(view.scrollDOM);
  }

  setSnapshot(snapshot: DiffReviewSnapshot): void {
    this.snapshot = snapshot;
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
  }

  private render(): void {
    const snapshot = this.snapshot;
    if (!snapshot || !this.root.isConnected) return;
    const root = this.root.getBoundingClientRect();
    this.svg.setAttribute("viewBox", `0 0 ${Math.max(1, root.width)} ${Math.max(1, root.height)}`);
    this.svg.replaceChildren();
    for (const block of snapshot.blocks) {
      for (const connection of this.connections) {
        const fromView = this.views[connection.from];
        const toView = this.views[connection.to];
        const fromRange = block.ranges[connection.from];
        const toRange = block.ranges[connection.to];
        if (!fromView || !toView || !fromRange || !toRange) continue;
        const source = measureDiffReviewRange(fromView, fromRange, root);
        const target = measureDiffReviewRange(toView, toRange, root);
        if (!source || !target) continue;
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", buildDiffReviewConnectorPath(source, target));
        path.setAttribute("class", [
          "diff-review-connector",
          `diff-review-connector-${block.status}`,
          block.id === snapshot.activeBlockId ? "is-active" : "",
        ].filter(Boolean).join(" "));
        path.dataset.blockId = block.id;
        this.svg.append(path);
      }
    }
  }
}
