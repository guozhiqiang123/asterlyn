import type { MergeView } from "@codemirror/merge";
import { linkHorizontalScrollGroup } from "../../presentation/linked-scroll.ts";

/** Owns the two docked horizontal scrollbar proxies used by an editable split Diff. */
export class EditableDiffScrollbars {
  private readonly container: HTMLDivElement;
  private readonly panes: readonly [HTMLDivElement, HTMLDivElement];
  private readonly contents: readonly [HTMLDivElement, HTMLDivElement];
  private readonly corner: HTMLDivElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly releaseScrollGroup: () => void;

  constructor(parent: HTMLElement, private readonly merge: MergeView) {
    const paneA = createPane("editable-diff-scrollbar-a");
    const paneB = createPane("editable-diff-scrollbar-b");
    this.container = document.createElement("div");
    this.container.className = "editable-diff-scrollbars";
    this.container.setAttribute("aria-hidden", "true");
    const spacer = document.createElement("div");
    spacer.className = "editable-diff-scrollbar-spacer";
    this.corner = document.createElement("div");
    this.corner.className = "editable-diff-scrollbar-corner";
    this.container.append(paneA.pane, spacer, paneB.pane, this.corner);
    parent.append(this.container);
    this.panes = [paneA.pane, paneB.pane];
    this.contents = [paneA.content, paneB.content];
    this.releaseScrollGroup = linkHorizontalScrollGroup([
      paneA.pane,
      paneB.pane,
      merge.a.scrollDOM,
      merge.b.scrollDOM,
    ]);
    this.resizeObserver = new ResizeObserver(() => this.update());
    for (const target of [merge.dom, merge.a.scrollDOM, merge.b.scrollDOM]) {
      this.resizeObserver.observe(target);
    }
    this.update();
  }

  update(): void {
    const a = this.merge.a.scrollDOM;
    const b = this.merge.b.scrollDOM;
    if (!a.isConnected || !b.isConnected) return;
    const sources = [a, b] as const;
    const visible = sources.some((source) => source.scrollWidth > source.clientWidth);
    this.container.style.display = visible ? "grid" : "none";
    if (!visible) return;
    for (const [index, source] of sources.entries()) {
      const maximum = Math.max(0, source.scrollWidth - source.clientWidth);
      this.contents[index]!.style.width = `${this.panes[index]!.clientWidth + maximum}px`;
    }
    const verticalWidth = Math.max(0, this.merge.dom.offsetWidth - this.merge.dom.clientWidth);
    this.container.style.setProperty(
      "--editable-diff-scrollbar-corner-width",
      `${verticalWidth}px`,
    );
    this.corner.style.width = `${verticalWidth}px`;
  }

  destroy(): void {
    this.releaseScrollGroup();
    this.resizeObserver.disconnect();
    this.container.remove();
  }
}

function createPane(suffix: string): { pane: HTMLDivElement; content: HTMLDivElement } {
  const pane = document.createElement("div");
  pane.className = `editable-diff-scrollbar-pane ${suffix}`;
  const content = document.createElement("div");
  content.className = "editable-diff-scrollbar-content";
  pane.append(content);
  return { pane, content };
}
